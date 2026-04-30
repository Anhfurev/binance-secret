-- Sandbox tuning: optional quote-volume floor for preflight FAIL_VOLUME.
-- 0 means "disable volume gate" for low-liquidity ghost/test runs.
alter table public.bot_settings
  add column if not exists min_volume_24h_quote numeric;

update public.bot_settings
set min_volume_24h_quote = 0
where min_volume_24h_quote is null;

alter table public.bot_settings
  alter column min_volume_24h_quote set default 0;

comment on column public.bot_settings.min_volume_24h_quote is
  'Optional 24h quote-volume floor used by preflight volume gate. 0 disables volume veto (recommended for sandbox/ghost tests).';
