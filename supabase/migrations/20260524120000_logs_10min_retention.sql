-- Retain all public.logs rows (errors, warns, info) for 10 minutes only.

create or replace function public.prune_logs_age_minutes(p_minutes integer default 10)
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n bigint;
begin
  if p_minutes < 1 or p_minutes > 24 * 60 then
    raise exception 'p_minutes out of range (1..1440)';
  end if;

  set local statement_timeout = '120s';

  delete from public.logs
  where created_at < now() - make_interval(mins => p_minutes);

  get diagnostics n = row_count;
  return n;
end;
$fn$;

comment on function public.prune_logs_age_minutes(integer) is
  'Deletes all logs older than p_minutes (default 10). No severity/source exceptions.';

revoke all on function public.prune_logs_age_minutes(integer) from public;
grant execute on function public.prune_logs_age_minutes(integer) to postgres;
grant execute on function public.prune_logs_age_minutes(integer) to service_role;

do $cron$
declare
  jid bigint;
begin
  for jid in
    select j.jobid
    from cron.job j
    where j.jobname = 'prune-logs-10min'
  loop
    perform cron.unschedule(jid);
  end loop;

  perform cron.schedule(
    'prune-logs-10min',
    '* * * * *',
    $$select public.prune_logs_age_minutes(10);$$
  );
end;
$cron$;
