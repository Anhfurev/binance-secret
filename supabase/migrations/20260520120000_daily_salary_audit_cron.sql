-- Daily salary audit: 00:00 UTC → daily-salary-audit Edge (BOT_SECRET header).

create or replace function public.invoke_daily_salary_audit_edge()
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_secret text;
  v_rid bigint;
  v_url constant text := 'https://emviaygygylosvmtsvlq.supabase.co/functions/v1/daily-salary-audit';
begin
  select trim(secret) into v_secret from public.bot_cron_http_secret where id = 1;
  if v_secret is null or v_secret = '' then
    raise exception 'bot_cron_http_secret is empty';
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-binance-bot-secret', v_secret
    ),
    body := '{}'::jsonb
  ) into v_rid;
  return v_rid;
end;
$fn$;

comment on function public.invoke_daily_salary_audit_edge() is
  'pg_cron entry: POST daily-salary-audit with x-binance-bot-secret from bot_cron_http_secret.';

revoke all on function public.invoke_daily_salary_audit_edge() from public;
grant execute on function public.invoke_daily_salary_audit_edge() to postgres;
grant execute on function public.invoke_daily_salary_audit_edge() to supabase_admin;

do $sched$
declare
  jid bigint;
begin
  select j.jobid into jid from cron.job j where j.jobname = 'daily-salary-audit-0000-utc' limit 1;
  if jid is not null then
    perform cron.unschedule(jid);
  end if;

  perform cron.schedule(
    'daily-salary-audit-0000-utc',
    '0 0 * * *',
    $job$select public.invoke_daily_salary_audit_edge();$job$
  );
end
$sched$;
