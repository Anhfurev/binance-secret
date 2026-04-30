-- Hard-wall fix: reserve_buy_capital was summing ALL open trades against live
-- headroom (including is_ghost and is_paper rows). That made ghost shadow-bots
-- silently starve the live bot by inflating v_open_sum, breaking the
-- "Ghost = Hard Wall" invariant required for valid live-vs-ghost PnL studies.
--
-- This migration redefines reserve_buy_capital to count ONLY live trades:
--   - extra->>'is_ghost' is not true
--   - extra->>'trade_mode' is null or 'live' (legacy rows w/o trade_mode are
--     treated as live for backward compatibility, since pre-ghost rows are
--     genuinely live capital).
--
-- Function signature is unchanged so no Edge code changes are required.

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

  -- LIVE-ONLY committed capital. Excludes:
  --   * ghost trades  (extra->>'is_ghost' = 'true')
  --   * paper trades  (extra->>'trade_mode' = 'paper')
  -- Rows missing extra/trade_mode are assumed live (legacy live-only data).
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

comment on function public.reserve_buy_capital(uuid, text, numeric, numeric) is
  'Locks p_requested_usd (+ min dust) under advisory lock; excludes ghost/paper trades from open-capital sum. Returns reservation id or null.';

grant execute on function public.reserve_buy_capital(uuid, text, numeric, numeric) to service_role;
grant execute on function public.reserve_buy_capital(uuid, text, numeric, numeric) to authenticated;
