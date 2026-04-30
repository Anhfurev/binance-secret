-- Weekly "Self-Upgrade": pg_cron invokes learning via net.http_post; secrets in Vault.
-- Ops: replace placeholder secrets (Dashboard > Vault or SQL) before relying on the job.
-- Target is typically: https://<PROJECT_REF>.supabase.co/functions/v1/binance-bot-learning
-- (POST + JSON). If you call Next.js GET /api/automation/learning/run instead, align URL + auth.

-- 1) Extensions -----------------------------------------------------------
-- Hosted Supabase: pg_cron / pg_net / vault are often pre-enabled. Creating
-- them from SQL can raise 2BP01 ("dependent privileges exist") on some plans.
-- Enable missing ones from Dashboard > Database > Extensions if needed.
do $ext$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron: %', sqlerrm;
end $ext$;

do $ext$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net: %', sqlerrm;
end $ext$;

do $ext$
begin
  create extension if not exists supabase_vault with schema vault;
exception when others then
  raise notice 'supabase_vault: %', sqlerrm;
end $ext$;

-- 2) Secrets (placeholders — update real values in production; do not commit real keys) ----------
do $vault$
begin
  if not exists (select 1 from vault.decrypted_secrets ds where ds.name = 'learning_function_url') then
    perform vault.create_secret(
      'https://YOUR_PROJECT_REF.supabase.co/functions/v1/binance-bot-learning',
      'learning_function_url',
      'Full URL for weekly learning / self-upgrade (Edge Function or HTTPS endpoint)'
    );
  end if;

  if not exists (select 1 from vault.decrypted_secrets ds where ds.name = 'service_role_key') then
    perform vault.create_secret(
      'REPLACE_WITH_SUPABASE_SERVICE_ROLE_JWT',
      'service_role_key',
      'Supabase service_role JWT for Authorization: Bearer (and apikey for Edge Functions)'
    );
  end if;
end
$vault$;

-- 3) Invoker: read secrets, POST JSON body, return pg_net request_id for correlation ------------
create or replace function public.invoke_weekly_self_upgrade()
returns bigint
language plpgsql
security definer
set search_path = public, net, vault, cron
as $fn$
declare
  v_url text;
  v_key text;
  v_body jsonb;
  v_headers jsonb;
  v_request_id bigint;
begin
  select ds.decrypted_secret
  into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'learning_function_url'
  limit 1;

  select ds.decrypted_secret
  into v_key
  from vault.decrypted_secrets ds
  where ds.name = 'service_role_key'
  limit 1;

  if v_url is null or btrim(v_url) = ''
     or v_url like '%YOUR_PROJECT_REF%'
  then
    raise exception 'Configure vault secret learning_function_url with your real HTTPS endpoint';
  end if;

  if v_key is null or btrim(v_key) = ''
     or v_key like 'REPLACE_WITH_%'
  then
    raise exception 'Configure vault secret service_role_key with your Supabase service_role JWT';
  end if;

  v_body := jsonb_build_object(
    'reason', 'weekly_scheduled_self_upgrade',
    'timestamp', to_jsonb(now())
  );

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || v_key,
    'apikey', v_key
  );

  select net.http_post(
    url := v_url,
    body := v_body,
    headers := v_headers
  )
  into v_request_id;

  return v_request_id;
end
$fn$;

comment on function public.invoke_weekly_self_upgrade() is
  'Called by pg_cron job weekly-ai-self-upgrade; POSTs JSON to learning_function_url using service_role_key from Vault.';

revoke all on function public.invoke_weekly_self_upgrade() from public;
grant execute on function public.invoke_weekly_self_upgrade() to postgres;

-- 4) Schedule: Sunday 00:00 UTC ------------------------------------------------------------------
do $sched$
declare
  jid bigint;
begin
  select j.jobid into jid from cron.job j where j.jobname = 'weekly-ai-self-upgrade' limit 1;
  if jid is not null then
    perform cron.unschedule(jid);
  end if;

  perform cron.schedule(
    'weekly-ai-self-upgrade',
    '0 0 * * 0',
    'select public.invoke_weekly_self_upgrade();'
  );
end
$sched$;

-- 5) Audit: cron runs + pg_net HTTP outcome (responses retained for a limited window by pg_net) --
create or replace view public.weekly_self_upgrade_cron_audit
with (security_invoker = true)
as
select
  j.jobname,
  jrd.jobid,
  jrd.runid,
  jrd.job_pid,
  jrd.database,
  jrd.username,
  jrd.command,
  jrd.status as cron_sql_status,
  jrd.return_message,
  case
    when jrd.return_message ~ '^[0-9]+$' then jrd.return_message::bigint
    else null
  end as pg_net_request_id,
  jrd.start_time,
  jrd.end_time,
  nr.status_code as http_status,
  nr.error_msg as http_error,
  left(nr.content::text, 4000) as http_body_preview
from cron.job j
join cron.job_run_details jrd on jrd.jobid = j.jobid
left join net._http_response nr
  on nr.id = case
    when jrd.return_message ~ '^[0-9]+$' then jrd.return_message::bigint
    else null::bigint
  end
where j.jobname = 'weekly-ai-self-upgrade';

comment on view public.weekly_self_upgrade_cron_audit is
  'Latest weekly-ai-self-upgrade runs: cron.job_run_details + net._http_response when return_message is the pg_net request id.';

revoke all on public.weekly_self_upgrade_cron_audit from public;
grant select on public.weekly_self_upgrade_cron_audit to service_role;

-- Invoker rights: dashboard queries this view as service_role (view uses security_invoker).
-- These grants can fail on managed Postgres (2BP01 / insufficient privilege); skip safely.
do $gr$
begin
  grant usage on schema cron to service_role;
  grant select on cron.job to service_role;
  grant select on cron.job_run_details to service_role;
  grant usage on schema net to service_role;
  grant select on net._http_response to service_role;
exception when others then
  raise notice 'weekly_self_upgrade cron/net grants skipped: %', sqlerrm;
end $gr$;
