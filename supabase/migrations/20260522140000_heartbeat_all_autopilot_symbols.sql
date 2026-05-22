-- pg_cron → HTTP POST binance-bot (Supabase Edge URL below).
-- Symbols: ALL rows with is_autopilot_enabled (your 10 bots). The JSON below is ONLY if that query returns zero rows.
-- Bot on Vultr instead? Point v_url at your VPS (e.g. http://127.0.0.1:8788 on gateway) or use scripts/vultr-bot-cron.sh + disable this job.

create or replace function public.invoke_binance_bot_edge_heartbeat()
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_secret text;
  v_rid bigint;
  v_symbols jsonb;
  v_url constant text := 'https://emviaygygylosvmtsvlq.supabase.co/functions/v1/binance-bot';
begin
  select trim(secret) into v_secret from public.bot_cron_http_secret where id = 1;
  if v_secret is null or v_secret = '' then
    raise exception
      'bot_cron_http_secret is empty: insert into public.bot_cron_http_secret (id, secret) values (1, ''<same as Edge BOT_SECRET>'') on conflict (id) do update set secret = excluded.secret, updated_at = now();';
  end if;

  select coalesce(
    jsonb_agg(distinct upper(trim(symbol)) order by upper(trim(symbol))),
    '[]'::jsonb
  )
  into v_symbols
  from public.bot_settings
  where is_autopilot_enabled = true
    and nullif(trim(symbol), '') is not null;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-binance-bot-secret', v_secret
    ),
    body := jsonb_build_object('symbols', v_symbols)
  ) into v_rid;
  return v_rid;
end;
$fn$;
