-- Real-time capital reservations for parallel BUY attempts.
-- reserve_buy_capital inserts a row and returns its id, or null if not enough headroom.

create table if not exists public.capital_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  symbol text,
  requested_usd numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists capital_reservations_user_id_idx
  on public.capital_reservations (user_id);

comment on table public.capital_reservations is
  'Short-lived BUY locks; edge function deletes the row in a finally block after order attempt.';

drop function if exists public.reserve_buy_capital(uuid, numeric);

create or replace function public.reserve_buy_capital(
  p_user_id uuid,
  p_symbol text,
  p_requested_usd numeric,
  p_min_dust_usd numeric default 2.0
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

  select coalesce(sum(coalesce(t.value, 0::numeric)), 0::numeric)
  into v_open_sum
  from public.trades t
  where t.user_id = p_user_id
    and lower(trim(coalesce(t.status, ''))) = 'open';

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

comment on function public.reserve_buy_capital(uuid, text, numeric, numeric) is
  'Locks p_requested_usd (+ min dust) under advisory lock; returns reservation id or null.';

grant execute on function public.reserve_buy_capital(uuid, text, numeric, numeric) to service_role;
grant execute on function public.reserve_buy_capital(uuid, text, numeric, numeric) to authenticated;
