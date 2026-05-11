-- pg_cron cannot rely on ALTER DATABASE ... SET app.cron_secret on Supabase (42501 for many roles).
-- Store the same value as Edge secret BOT_SECRET here; cron calls SECURITY DEFINER wrapper.

create table if not exists public.bot_cron_http_secret (
  id smallint primary key default 1 check (id = 1),
  secret text not null default '',
  updated_at timestamptz not null default now()
);

comment on table public.bot_cron_http_secret is
  'Single row id=1: x-binance-bot-secret for pg_cron → binance-bot Edge. Must match Edge BOT_SECRET. No ALTER DATABASE needed.';

alter table public.bot_cron_http_secret enable row level security;

revoke all on public.bot_cron_http_secret from public;
revoke all on public.bot_cron_http_secret from anon, authenticated;

-- Replace host if you fork this migration to another Supabase project.
create or replace function public.invoke_binance_bot_edge_heartbeat()
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_secret text;
  v_rid bigint;
  v_url constant text := 'https://emviaygygylosvmtsvlq.supabase.co/functions/v1/binance-bot';
begin
  select trim(secret) into v_secret from public.bot_cron_http_secret where id = 1;
  if v_secret is null or v_secret = '' then
    raise exception
      'bot_cron_http_secret is empty: insert into public.bot_cron_http_secret (id, secret) values (1, ''<same as Edge BOT_SECRET>'') on conflict (id) do update set secret = excluded.secret, updated_at = now();';
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-binance-bot-secret', v_secret
    ),
    body := '{"symbols":["BTCUSDT","SOLUSDT","PEPEUSDT"]}'::jsonb
  ) into v_rid;
  return v_rid;
end;
$fn$;

comment on function public.invoke_binance_bot_edge_heartbeat() is
  'pg_cron entry: POST binance-bot with x-binance-bot-secret from bot_cron_http_secret.';

revoke all on function public.invoke_binance_bot_edge_heartbeat() from public;
grant execute on function public.invoke_binance_bot_edge_heartbeat() to postgres;
grant execute on function public.invoke_binance_bot_edge_heartbeat() to supabase_admin;

do $sched$
declare
  jid bigint;
begin
  select j.jobid into jid from cron.job j where j.jobname = 'bot-heartbeat-all-symbols' limit 1;
  if jid is not null then
    perform cron.unschedule(jid);
  end if;

  perform cron.schedule(
    'bot-heartbeat-all-symbols',
    '* * * * *',
    $job$select public.invoke_binance_bot_edge_heartbeat();$job$
  );
end
$sched$;
