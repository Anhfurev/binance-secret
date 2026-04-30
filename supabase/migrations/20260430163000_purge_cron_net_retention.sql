-- Prevent pg_cron + pg_net history from consuming hundreds of MB:
-- `cron.job_run_details.return_message` stores pg_net request ids and status text;
-- `net._http_response.content` holds full HTTP bodies (Edge Function JSON), often huge per run.

create or replace function public.purge_internal_cron_and_net_http_retention()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  delete from cron.job_run_details
  where start_time < (now() - interval '5 days');

  with keep as (
    select id from net._http_response order by created desc limit 120
  )
  delete from net._http_response n
  where not exists (select 1 from keep k where k.id = n.id);
end
$fn$;

comment on function public.purge_internal_cron_and_net_http_retention() is
  'Daily hygiene: trim cron.job_run_details and cap net._http_response rows so pg_net bodies do not blow DB quota.';

revoke all on function public.purge_internal_cron_and_net_http_retention() from public;
grant execute on function public.purge_internal_cron_and_net_http_retention() to postgres;

do $sched$
declare
  jid bigint;
begin
  select j.jobid into jid from cron.job j where j.jobname = 'purge-cron-net-retention' limit 1;
  if jid is not null then
    perform cron.unschedule(jid);
  end if;

  perform cron.schedule(
    'purge-cron-net-retention',
    '20 3 * * *',
    'select public.purge_internal_cron_and_net_http_retention();'
  );
end
$sched$;
