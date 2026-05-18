-- Allow sub-1% trailing stops (e.g. 0.50% = 0.0050) for elite grinder symbols.
alter table public.bot_settings
  alter column trailing_stop_pct type numeric(10, 4);

comment on column public.bot_settings.trailing_stop_pct is
  'Trailing stop as decimal fraction of price (0.005 = 0.5%, 0.0175 = 1.75%).';
