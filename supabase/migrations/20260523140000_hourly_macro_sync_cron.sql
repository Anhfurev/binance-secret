-- Optional pg_cron hook for hourly macro sync (requires bot_cron_http_secret + Edge deploy).
-- POST binance-bot with body: {"hourly_sync_only":true}

comment on table public.bot_global_settings is
  'Macro regime from hourly_sync_only cron; fast lane reads latest row each tick.';

-- Example schedule (uncomment after verifying secret row):
-- select cron.unschedule(jobid) from cron.job where jobname = 'bot-hourly-macro-sync';
-- select cron.schedule(
--   'bot-hourly-macro-sync',
--   '0 * * * *',
--   $job$
--   select net.http_post(
--     url := 'https://YOUR_PROJECT.supabase.co/functions/v1/binance-bot',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-binance-bot-secret', (select trim(secret) from public.bot_cron_http_secret where id = 1)
--     ),
--     body := '{"hourly_sync_only":true}'::jsonb
--   );
--   $job$
-- );
