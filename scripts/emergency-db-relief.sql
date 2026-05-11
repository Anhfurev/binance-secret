-- Run in Supabase SQL Editor when the project is CPU/IO bound or REST/API times out.
--
-- FIRST: reduce pg_cron fan-out. If you still have six jobs/minute (setup-cron legacy),
-- apply migration `20260512100000_consolidate_cron_batch_prune.sql` or run `supabase/setup-cron.sql`
-- (edit YOUR_PROJECT_REF). That fixes most "connection terminated due to connection timeout" errors.
--
-- Requires: prune_logs_non_essential function (optional for §2–§4).

-- 1) Trim pg_net + cron history (if migration purge_internal_cron_and_net_retention exists).
--    Skip this line if you get "function does not exist".
-- select public.purge_internal_cron_and_net_http_retention();

-- 2) Prefer selective prune (keeps execution/decision/errors — see function body).
select public.prune_logs_non_essential(48);

-- 3) If function missing: delete only obvious noise (safe fallback).
-- delete from public.logs
-- where created_at < now() - interval '48 hours'
--   and coalesce(source,'') in ('runtime','ai','safe-execute','ccxt')
--   and coalesce(level,'') = 'info';

-- 4) Old cron rows (reduces planner noise).
-- delete from cron.job_run_details where start_time < now() - interval '3 days';

-- 5) After large deletes:
-- vacuum analyze public.logs;
