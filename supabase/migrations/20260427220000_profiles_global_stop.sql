-- Emergency kill-switch for binance-bot (supabase/functions/binance-bot/index.ts).
-- Without this column, Postgres returns 42703 and the function logs global_stop_column_missing (non-fatal).
alter table if exists public.profiles
  add column if not exists global_stop boolean not null default false;

comment on column public.profiles.global_stop is
  'When true, binance-bot aborts the entire cycle without trading (emergency stop).';
