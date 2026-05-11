-- 1) Root cause of DB/API timeouts: six pg_cron jobs per minute → six Edge runs + pg_sleep contention.
--    Replace with ONE job posting all symbols (matches Edge body {"symbols":[...]}).
-- 2) prune_logs_non_essential: batched deletes + statement_timeout so prune itself cannot wedge the DB.

create or replace function public.prune_logs_non_essential(p_min_age_hours integer default 72)
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n bigint := 0;
  batch bigint;
  batch_limit constant int := 8000;
begin
  if p_min_age_hours < 1 or p_min_age_hours > 24 * 120 then
    raise exception 'p_min_age_hours out of range';
  end if;

  set local statement_timeout = '600s';

  loop
    delete from public.logs
    where ctid in (
      select t.ctid
      from public.logs t
      where t.created_at < now() - make_interval(hours => p_min_age_hours)
        and not (
          coalesce(t.level, '') in ('error', 'warn')
          or coalesce(t.source, '') in (
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
          or coalesce(t.message, '') in (
            'buy_fill_quality',
            'sell_fill_quality',
            'retention_cleanup_executed',
            'stale_trade_guard_alert',
            'symbol_cycle_failed',
            'late_completion_after_timeout',
            'cron_batch_start',
            'fatal_boundary'
          )
          or coalesce(t.meta ->> 'event', '') in (
            'execution_outcome',
            'buy_fill_quality',
            'sell_fill_quality',
            'late_completion_after_timeout'
          )
        )
      limit batch_limit
    );
    get diagnostics batch = row_count;
    n := n + batch;
    exit when batch = 0;
  end loop;

  return n;
end;
$fn$;

-- Unschedule legacy 6-job-per-minute fan-out (names from supabase/setup-cron.sql).
do $un$
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
    exception
      when others then null;
    end;
  end loop;
end
$un$;

-- Remove previous consolidated job if re-running migration.
do $un2$
begin
  begin
    perform cron.unschedule('bot-heartbeat-all-symbols');
  exception
    when others then null;
  end;
end
$un2$;

-- One Edge invocation per minute with all symbols (secret from app.cron_secret).
select cron.schedule(
  'bot-heartbeat-all-symbols',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://emviaygygylosvmtsvlq.supabase.co/functions/v1/binance-bot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-binance-bot-secret', coalesce(nullif(current_setting('app.cron_secret', true), ''), '')
    ),
    body := '{"symbols":["BTCUSDT","SOLUSDT","PEPEUSDT"]}'::jsonb
  ) as request_id;
  $job$
);

grant execute on function public.prune_logs_non_essential(integer) to service_role;

-- Older installs may still have a duplicate every-minute job (`binance-bot-heartbeat`).
do $dup$
begin
  begin
    perform cron.unschedule('binance-bot-heartbeat');
  exception when others then null;
  end;
end
$dup$;
