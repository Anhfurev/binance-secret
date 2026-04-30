-- Phase 4: DB-backed AI runtime state + cache score fields + OB feature flag.

CREATE TABLE IF NOT EXISTS public.ai_quota_state (
  scope text PRIMARY KEY,
  consecutive_gemini_failures integer NOT NULL DEFAULT 0,
  gemini_cooldown_until timestamptz,
  current_gemini_key_index integer NOT NULL DEFAULT 0,
  current_groq_key_index integer NOT NULL DEFAULT 0,
  gemini_key_cooldowns jsonb NOT NULL DEFAULT '{}'::jsonb,
  groq_key_cooldowns jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_cache
  ADD COLUMN IF NOT EXISTS trend_score numeric,
  ADD COLUMN IF NOT EXISTS momentum_score numeric,
  ADD COLUMN IF NOT EXISTS volume_score numeric,
  ADD COLUMN IF NOT EXISTS order_book_score numeric,
  ADD COLUMN IF NOT EXISTS sentiment_haircut_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sentiment_penalty_factor numeric;

ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS order_book_imbalance_exit_disabled_until timestamptz;

CREATE INDEX IF NOT EXISTS ai_quota_state_updated_idx
  ON public.ai_quota_state (updated_at DESC);
