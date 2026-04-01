-- =============================================================================
-- Supabase 24/7 Bot Heartbeat Setup
-- Run this ONCE in: Supabase Dashboard > SQL Editor
-- =============================================================================

-- Step 1: Enable required extensions (safe to run multiple times)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Step 2: Store your CRON_SECRET as a database parameter so it never appears
--         in plaintext in cron job definitions. Replace the value below with
--         the same random string you set in Vercel and Supabase Edge Function secrets.
alter database postgres
  set app.cron_secret = 'REPLACE_WITH_YOUR_CRON_SECRET';

-- Step 3: Schedule the Edge Function to run every minute.
--         Replace YOUR_SUPABASE_PROJECT_REF with your project ref
--         (visible in: Supabase Dashboard > Settings > General, e.g. "emviaygygylosvmtsvlq").
select cron.schedule(
  '24-7-binance-bot',        -- job name (must be unique)
  '* * * * *',               -- every minute
  $$
  select net.http_post(
    url     := 'https://emviaygygylosvmtsvlq.supabase.co/functions/v1/binance-bot',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-cron-secret',  current_setting('app.cron_secret', true)
    ),
    body    := '{}'::jsonb
  ) as request_id;
  $$
);

-- =============================================================================
-- Useful maintenance queries
-- =============================================================================

-- View all scheduled jobs:
-- select * from cron.job;

-- View recent run history (pass/fail + output):
-- select * from cron.job_run_details order by start_time desc limit 20;

-- Remove the job if you want to pause it:
-- select cron.unschedule('24-7-binance-bot');
