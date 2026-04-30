-- Serialize per-user BUY affordability checks (parallel Edge invocations).
-- Total USDT: latest account_balances.balance, else profiles.demo_balance.
-- Committed capital: sum of open trade notionals (trades."value").

create or replace function public.reserve_buy_capital(
  p_user_id uuid,
  p_requested_usd numeric
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_total numeric;
  v_open_sum numeric;
  v_available numeric;
begin
  if p_user_id is null or p_requested_usd is null or p_requested_usd <= 0 then
    return false;
  end if;

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

  v_available := coalesce(v_total, 0::numeric) - coalesce(v_open_sum, 0::numeric);

  return v_available >= p_requested_usd;
end;
$$;

comment on function public.reserve_buy_capital(uuid, numeric) is
  'Advisory-lock per user; true if (latest balance or demo_balance) minus open trade value covers p_requested_usd.';

grant execute on function public.reserve_buy_capital(uuid, numeric) to service_role;
grant execute on function public.reserve_buy_capital(uuid, numeric) to authenticated;
