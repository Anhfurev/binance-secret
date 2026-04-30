-- =============================================================================
-- Supabase 24/7 Bot Heartbeat Setup
-- Run this ONCE in: Supabase Dashboard > SQL Editor
-- =============================================================================

-- Step 1: Enable required extensions (safe to run multiple times)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Step 2: Store a shared secret (must match Edge Function secret BOT_SECRET).
--         pg_cron sends it as header x-binance-bot-secret (no user JWT).
alter database postgres
  set app.cron_secret = 'REPLACE_WITH_YOUR_BOT_SECRET';

-- Step 3: Schedule symbol-specific staggered heartbeats.
--         Each symbol runs every 30s, but offset across the minute to spread load:
--         BTC: 0s / 30s
--         SOL: 10s / 40s
--         PEPE: 20s / 50s
--         IMPORTANT: index.ts must support body {"symbol":"..."} filtering
--         (this repo does).
--         Replace YOUR_SUPABASE_PROJECT_REF with your project ref
--         (visible in: Supabase Dashboard > Settings > General, e.g. "emviaygygylosvmtsvlq").
select cron.schedule(
  '24-7-binance-btc-0s',     -- job name (must be unique)
  '* * * * *',               -- every minute
  $$
  select net.http_post(
    url     := 'https://emviaygygylosvmtsvlq.supabase.co/functions/v1/binance-bot',
    headers := jsonb_build_object(
      'Content-Type',            'application/json',
      'x-binance-bot-secret',   current_setting('app.cron_secret', true)
    ),
    body    := '{"symbol":"BTCUSDT"}'::jsonb
  ) as request_id;
  $$
);

select cron.schedule(
  '24-7-binance-btc-30s',    -- second heartbeat offset by 30s
  '* * * * *',               -- every minute
  $$
  select pg_sleep(30);
  select net.http_post(
    url     := 'https://emviaygygylosvmtsvlq.supabase.co/functions/v1/binance-bot',
    headers := jsonb_build_object(
      'Content-Type',            'application/json',
      'x-binance-bot-secret',   current_setting('app.cron_secret', true)
    ),
    body    := '{"symbol":"BTCUSDT"}'::jsonb
  ) as request_id;
  $$
);

select cron.schedule(
  '24-7-binance-sol-10s',
  '* * * * *',
  $$
  select pg_sleep(10);
  select net.http_post(
    url     := 'https://emviaygygylosvmtsvlq.supabase.co/functions/v1/binance-bot',
    headers := jsonb_build_object(
      'Content-Type',            'application/json',
      'x-binance-bot-secret',   current_setting('app.cron_secret', true)
    ),
    body    := '{"symbol":"SOLUSDT"}'::jsonb
  ) as request_id;
  $$
);

select cron.schedule(
  '24-7-binance-sol-40s',
  '* * * * *',
  $$
  select pg_sleep(40);
  select net.http_post(
    url     := 'https://emviaygygylosvmtsvlq.supabase.co/functions/v1/binance-bot',
    headers := jsonb_build_object(
      'Content-Type',            'application/json',
      'x-binance-bot-secret',   current_setting('app.cron_secret', true)
    ),
    body    := '{"symbol":"SOLUSDT"}'::jsonb
  ) as request_id;
  $$
);

select cron.schedule(
  '24-7-binance-pepe-20s',
  '* * * * *',
  $$
  select pg_sleep(20);
  select net.http_post(
    url     := 'https://emviaygygylosvmtsvlq.supabase.co/functions/v1/binance-bot',
    headers := jsonb_build_object(
      'Content-Type',            'application/json',
      'x-binance-bot-secret',   current_setting('app.cron_secret', true)
    ),
    body    := '{"symbol":"PEPEUSDT"}'::jsonb
  ) as request_id;
  $$
);

select cron.schedule(
  '24-7-binance-pepe-50s',
  '* * * * *',
  $$
  select pg_sleep(50);
  select net.http_post(
    url     := 'https://emviaygygylosvmtsvlq.supabase.co/functions/v1/binance-bot',
    headers := jsonb_build_object(
      'Content-Type',            'application/json',
      'x-binance-bot-secret',   current_setting('app.cron_secret', true)
    ),
    body    := '{"symbol":"PEPEUSDT"}'::jsonb
  ) as request_id;
  $$
);

-- Step 4: Weekly Sunday summary job (23:59 UTC every Sunday).
--         Writes weekly stats into public.sunday_summaries.
select cron.schedule(
  'sunday-summary-2359',
  '59 23 * * 0',
  $$
  select net.http_post(
    url     := 'https://emviaygygylosvmtsvlq.supabase.co/functions/v1/sunday-summary',
    headers := jsonb_build_object(
      'Content-Type',            'application/json',
      'x-binance-bot-secret',   current_setting('app.cron_secret', true)
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

-- Remove jobs if you want to pause them:
-- select cron.unschedule('24-7-binance-btc-0s');
-- select cron.unschedule('24-7-binance-btc-30s');
-- select cron.unschedule('24-7-binance-sol-10s');
-- select cron.unschedule('24-7-binance-sol-40s');
-- select cron.unschedule('24-7-binance-pepe-20s');
-- select cron.unschedule('24-7-binance-pepe-50s');
-- select cron.unschedule('sunday-summary-2359');
