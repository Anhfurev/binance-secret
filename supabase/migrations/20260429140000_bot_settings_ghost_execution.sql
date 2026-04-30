-- Shadow / "ghost" execution: full trade rows + logs, no Binance orders (see resolveGhostMode in Edge).

alter table public.bot_settings
  add column if not exists is_ghost_execution boolean not null default false;

comment on column public.bot_settings.is_ghost_execution is
  'When true, the bot persists BUY/SELL like production but createOrder never hits Binance; trades.extra marks trade_mode=ghost.';
