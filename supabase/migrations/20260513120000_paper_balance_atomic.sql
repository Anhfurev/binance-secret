-- Paper/demo equity: parallel symbol batches were racing on profiles.demo_balance
-- (Promise.all per symbol + skipped reserve_buy_capital for paper). Serialize with
-- advisory locks + atomic delta updates.

create or replace function public.reserve_buy_capital(
  p_user_id uuid,
  p_symbol text,
  p_requested_usd numeric,
  p_min_dust_usd numeric default 2.0,
  p_use_profile_demo_only boolean default false
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_total numeric;
  v_open_sum numeric;
  v_reserved_sum numeric;
  v_available numeric;
  v_need numeric;
  v_dust numeric;
  v_id uuid;
begin
  if p_user_id is null or p_requested_usd is null or p_requested_usd <= 0 then
    return null;
  end if;

  v_dust := greatest(coalesce(p_min_dust_usd, 0::numeric), 0::numeric);
  v_need := p_requested_usd + v_dust;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  if coalesce(p_use_profile_demo_only, false) then
    select coalesce(p.demo_balance::numeric, 0::numeric)
    into v_total
    from public.profiles p
    where p.id = p_user_id;
  else
    select coalesce(
      (
        select ab.balance::numeric
        from public.account_balances ab
        where ab.user_id = p_user_id
        order by ab.timestamp desc nulls last
        limit 1
      ),
      (select p.demo_balance::numeric from public.profiles p where p.id = p_user_id limit 1),
      0::numeric
    )
    into v_total;
  end if;

  select coalesce(sum(coalesce(t.value, 0::numeric)), 0::numeric)
  into v_open_sum
  from public.trades t
  where t.user_id = p_user_id
    and lower(trim(coalesce(t.status, ''))) = 'open'
    and coalesce((t.extra->>'is_ghost')::boolean, false) = false
    and coalesce(t.extra->>'trade_mode', 'live') = 'live';

  select coalesce(sum(coalesce(r.requested_usd, 0::numeric)), 0::numeric)
  into v_reserved_sum
  from public.capital_reservations r
  where r.user_id = p_user_id;

  v_available := coalesce(v_total, 0::numeric)
    - coalesce(v_open_sum, 0::numeric)
    - coalesce(v_reserved_sum, 0::numeric);

  if v_available < v_need then
    return null;
  end if;

  insert into public.capital_reservations (user_id, symbol, requested_usd)
  values (p_user_id, nullif(trim(coalesce(p_symbol, '')), ''), p_requested_usd)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.reserve_buy_capital(uuid, text, numeric, numeric, boolean) is
  'Locks headroom under advisory lock; live uses latest account_balances then demo; paper passes p_use_profile_demo_only=true for profiles.demo_balance only.';

grant execute on function public.reserve_buy_capital(uuid, text, numeric, numeric, boolean) to service_role;
grant execute on function public.reserve_buy_capital(uuid, text, numeric, numeric, boolean) to authenticated;

-- Drop 4-arg overload so PostgREST resolves the 5-arg version (last param has default).
drop function if exists public.reserve_buy_capital(uuid, text, numeric, numeric);

create or replace function public.paper_adjust_demo_balance(
  p_user_id uuid,
  p_delta_usd numeric
)
returns numeric
language plpgsql
set search_path = public
as $$
declare
  v_new numeric;
begin
  if p_user_id is null or p_delta_usd is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  update public.profiles
  set demo_balance = greatest(
      0::numeric,
      round(coalesce(demo_balance, 0)::numeric + p_delta_usd::numeric, 2)
    ),
      updated_at = now()
  where id = p_user_id
  returning demo_balance into v_new;

  if v_new is null then
    raise exception 'paper_adjust_demo_balance: profile missing for user id';
  end if;

  return v_new;
end;
$$;

comment on function public.paper_adjust_demo_balance(uuid, numeric) is
  'Atomic demo_balance += delta with per-user advisory lock (paper/ghost fills).';

grant execute on function public.paper_adjust_demo_balance(uuid, numeric) to service_role;
grant execute on function public.paper_adjust_demo_balance(uuid, numeric) to authenticated;
