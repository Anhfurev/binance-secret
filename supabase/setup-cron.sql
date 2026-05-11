-- =============================================================================
-- Supabase 24/7 Bot — SINGLE consolidated cron (recommended)
-- =============================================================================
-- Legacy setups used SIX jobs per minute (per-symbol × staggered pg_sleep),
-- which overloaded Edge + Postgres and caused "connection timeout".
-- This version sends ONE request per minute with all symbols.
--
-- Run once in: Supabase Dashboard → SQL Editor
-- Replace YOUR_PROJECT_REF in the URL below. Secret must match Edge secret BOT_SECRET.
-- NOTE: `alter database ... set app.cron_secret` often fails with 42501 on Supabase — use
--       migration `20260516120000_cron_bot_secret_table.sql` + INSERT into bot_cron_http_secret.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Optional legacy (requires superuser — usually skip on Supabase hosted):
-- alter database postgres set app.cron_secret = 'REPLACE_WITH_YOUR_BOT_SECRET';

-- Preferred on Supabase: after migration cron_bot_secret_table exists, set the secret once:
-- insert into public.bot_cron_http_secret (id, secret)
-- values (1, 'REPLACE_WITH_YOUR_BOT_SECRET')
-- on conflict (id) do update set secret = excluded.secret, updated_at = now();

-- Remove old fan-out jobs if present (ignore errors if names differ).
do $$
declare
  job_name text;
  names text[] := array[
    '24-7-binance-btc-0s',
    '24-7-binance-btc-30s',
    '24-7-binance-sol-10s',
    '24-7-binance-sol-40s',
    '24-7-binance-pepe-20s',
    '24-7-binance-pepe-50s'
  ];
begin
  foreach job_name in array names
  loop
    begin
      perform cron.unschedule(job_name);
    exception when others then null;
    end;
  end loop;
end $$;

do $x$
begin
  perform cron.unschedule('bot-heartbeat-all-symbols');
exception when others then null;
end $x$;

-- Cron calls wrapper (URL + header live in function; secret from bot_cron_http_secret).
-- Run the INSERT above first, or edit migration function URL for YOUR_PROJECT_REF.
select cron.schedule(
  'bot-heartbeat-all-symbols',
  '* * * * *',
  $$select public.invoke_binance_bot_edge_heartbeat();$$
);

-- Optional: Sunday summary (unchanged URL pattern).
-- select cron.schedule(
--   'sunday-summary-2359',
--   '59 23 * * 0',
--   $$ ... sunday-summary ... $$
-- );

-- verify:
-- select jobid, jobname, schedule, command from cron.job order by jobname;
