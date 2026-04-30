-- Post-mortem learning: one row per closed BUY evaluated 24h after close.
-- Optional regime-specific BUY floors on bot_settings (null = use min_ai_confidence).

create table if not exists public.ai_performance_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  bot_id uuid references public.bot_settings (id) on delete set null,
  trade_id uuid not null references public.trades (id) on delete cascade,
  symbol text not null,
  market_regime text not null default 'NEUTRAL',
  market_tags jsonb not null default '{}'::jsonb,
  predicted_confidence numeric(10, 4),
  entry_price numeric(28, 12) not null,
  exit_price numeric(28, 12),
  trade_closed_at timestamptz not null,
  horizon_target_at timestamptz not null,
  price_at_horizon numeric(28, 12),
  actual_return_24h_pct numeric(12, 6),
  outcome_directionally_correct boolean,
  calibration_delta_pct numeric(10, 4) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  constraint ai_performance_memory_trade_id_key unique (trade_id)
);

create index if not exists idx_ai_performance_memory_user_created
  on public.ai_performance_memory (user_id, created_at desc);

create index if not exists idx_ai_performance_memory_bot_regime
  on public.ai_performance_memory (bot_id, market_regime, created_at desc);

comment on table public.ai_performance_memory is
  '24h post-close evaluation of BUY signals: forward return vs entry, regime tag, optional calibration hints.';

alter table public.bot_settings
  add column if not exists min_ai_confidence_trending integer,
  add column if not exists min_ai_confidence_ranging integer;

comment on column public.bot_settings.min_ai_confidence_trending is
  'Optional BUY confidence floor when snapshot.marketRegime is TRENDING; null uses min_ai_confidence.';

comment on column public.bot_settings.min_ai_confidence_ranging is
  'Optional BUY confidence floor when snapshot.marketRegime is RANGING; null uses min_ai_confidence.';

alter table public.ai_performance_memory enable row level security;
