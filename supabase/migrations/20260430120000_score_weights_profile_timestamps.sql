-- Per-profile last run for score-weight learning: TF and MR can advance on
-- different monthly clocks (e.g. enough MR samples but not TF).

alter table public.bot_settings
  add column if not exists score_weights_tf_updated_at timestamptz,
  add column if not exists score_weights_mr_updated_at timestamptz;

comment on column public.bot_settings.score_weights_tf_updated_at is
  'Last time monthly feature-weight calibration ran for trend_following (TF) pack.';

comment on column public.bot_settings.score_weights_mr_updated_at is
  'Last time monthly feature-weight calibration ran for mean_reversion (MR) pack.';

-- Backfill from legacy single timestamp so we do not immediately re-run both.
update public.bot_settings
set
  score_weights_tf_updated_at = coalesce(score_weights_tf_updated_at, score_weights_updated_at),
  score_weights_mr_updated_at = coalesce(score_weights_mr_updated_at, score_weights_updated_at)
where score_weights_updated_at is not null;
