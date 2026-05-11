-- Offload retention + stale-trade housekeeping from the per-minute trading cron.

create or replace function public.invoke_binance_bot_edge_maintenance()
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
    body := '{"maintenance_only":true}'::jsonb
  ) into v_rid;
  return v_rid;
end;
$fn$;

comment on function public.invoke_binance_bot_edge_maintenance() is
  'pg_cron entry: POST binance-bot maintenance_only (retention + stale trade guard + capital reservation prune).';

revoke all on function public.invoke_binance_bot_edge_maintenance() from public;
grant execute on function public.invoke_binance_bot_edge_maintenance() to postgres;
grant execute on function public.invoke_binance_bot_edge_maintenance() to supabase_admin;

do $sched$
declare
  jid bigint;
begin
  select j.jobid into jid from cron.job j where j.jobname = 'bot-maintenance-housekeeping' limit 1;
  if jid is not null then
    perform cron.unschedule(jid);
  end if;

  perform cron.schedule(
    'bot-maintenance-housekeeping',
    '0 */4 * * *',
    $job$select public.invoke_binance_bot_edge_maintenance();$job$
  );
end
$sched$;
