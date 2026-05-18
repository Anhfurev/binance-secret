-- Supabase Table Editor / legacy clients expect logs.timestamp; canonical column is created_at.

alter table public.logs
  add column if not exists "timestamp" timestamptz
  generated always as (created_at) stored;

comment on column public.logs."timestamp" is
  'Generated alias of created_at for dashboard sorting and legacy queries.';

create index if not exists idx_logs_timestamp_desc
  on public.logs ("timestamp" desc);

-- Rollback: alter table public.logs drop column if exists "timestamp";
