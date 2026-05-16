-- Restore every-minute heartbeat. A prior draft used */2 * * * *; overlapping with an
-- external server-triggered bot caused duplicate load — keep pg_cron at 1/min.

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
