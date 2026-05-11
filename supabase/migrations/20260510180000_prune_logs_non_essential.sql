-- Selective log pruning: keep execution traces, errors/warns, health, fills;
-- drop high-volume noise (per-tick runtime, verbose ai info) once aged.

create or replace function public.prune_logs_non_essential(p_min_age_hours integer default 72)
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n bigint;
begin
  if p_min_age_hours < 1 or p_min_age_hours > 24 * 120 then
    raise exception 'p_min_age_hours out of range';
  end if;

  delete from public.logs
  where created_at < now() - make_interval(hours => p_min_age_hours)
  and not (
    coalesce(level, '') in ('error', 'warn')
    or coalesce(source, '') in (
      'execution-quality',
      'health-check',
      'edge-fatal',
      'symbol-cycle',
      'bot-cycle-error',
      'bot-timeout-race',
      'execution-outcome',
      'decision-trace',
      'cycle-summary',
      'war-room',
      'buy-flow-error',
      'debugger-health',
      'ops-heartbeat',
      'demo-probe-buy',
      'buy-flow',
      'safety',
      'market-data',
      'balance-sync',
      'mock-execution',
      'paper_snapshot_only',
      'ohlcv_fetch_failed',
      'dry-run',
      'bot-skip',
      'bot-cycle'
    )
    or coalesce(message, '') in (
      'buy_fill_quality',
      'sell_fill_quality',
      'retention_cleanup_executed',
      'stale_trade_guard_alert',
      'symbol_cycle_failed',
      'late_completion_after_timeout',
      'cron_batch_start',
      'fatal_boundary'
    )
    or coalesce(meta ->> 'event', '') in (
      'execution_outcome',
      'buy_fill_quality',
      'sell_fill_quality',
      'late_completion_after_timeout'
    )
  );

  get diagnostics n = row_count;
  return n;
end;
$fn$;

comment on function public.prune_logs_non_essential(integer) is
  'Deletes aged non-essential application logs; retains execution/health/errors for tuning.';

revoke all on function public.prune_logs_non_essential(integer) from public;
grant execute on function public.prune_logs_non_essential(integer) to postgres;
grant execute on function public.prune_logs_non_essential(integer) to service_role;

do $sched$
declare
  jid bigint;
begin
  select j.jobid into jid from cron.job j where j.jobname = 'daily-prune-noisy-logs' limit 1;
  if jid is not null then
    perform cron.unschedule(jid);
  end if;

  perform cron.schedule(
    'daily-prune-noisy-logs',
    '25 3 * * *',
    'select public.prune_logs_non_essential(72);'
  );
end
$sched$;
