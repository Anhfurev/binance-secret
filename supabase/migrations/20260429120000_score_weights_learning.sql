-- Learned AI scorecard weights (trend / momentum / volume / order_book) from post-mortem correlation.

alter table public.bot_settings
  add column if not exists score_weights_tf jsonb,
  add column if not exists score_weights_mr jsonb,
  add column if not exists score_weights_updated_at timestamptz;

comment on column public.bot_settings.score_weights_tf is
  'Optional trend-following score weights {trend,momentum,volume,order_book}; null uses Edge defaults.';

comment on column public.bot_settings.score_weights_mr is
  'Optional RANGING / mean-reversion score weights; null uses Edge defaults.';

comment on column public.bot_settings.score_weights_updated_at is
  'Last time monthly feature-weight calibration ran for this bot row.';
