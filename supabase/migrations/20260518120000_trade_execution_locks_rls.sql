-- Harden trade_execution_locks: RLS on for PostgREST roles; Edge service_role bypasses RLS.
-- Rollback: ALTER TABLE public.trade_execution_locks DISABLE ROW LEVEL SECURITY;
--           REVOKE/GRANT restore per your prior policy if you customized grants.

alter table if exists public.trade_execution_locks enable row level security;

revoke all on table public.trade_execution_locks from anon;
revoke all on table public.trade_execution_locks from authenticated;

comment on table public.trade_execution_locks is
  'Short-lived claim before createOrder; unique (bot_id,cycle_id,side) blocks double-submit. '
  'RLS enabled with no policies for anon/authenticated (deny). Edge Function uses service_role '
  'which bypasses RLS. Stale rows pruned by Edge (see TRADE_EXEC_LOCK_* env).';
