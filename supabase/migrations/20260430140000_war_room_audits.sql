-- Veto transparency: one row per bot cycle with structured gate failures.
-- If `war_room_audits` already exists without `user_id` (or other columns), ALTER adds them before indexes.

CREATE TABLE IF NOT EXISTS public.war_room_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  symbol text NOT NULL DEFAULT 'UNKNOWN',
  bot_id uuid,
  cycle_id text,
  veto_details text,
  final_decision text,
  technical_score integer,
  ai_confidence numeric
);

ALTER TABLE public.war_room_audits
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL;
ALTER TABLE public.war_room_audits
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.war_room_audits
  ADD COLUMN IF NOT EXISTS symbol text;
ALTER TABLE public.war_room_audits
  ADD COLUMN IF NOT EXISTS bot_id uuid;
ALTER TABLE public.war_room_audits
  ADD COLUMN IF NOT EXISTS cycle_id text;
ALTER TABLE public.war_room_audits
  ADD COLUMN IF NOT EXISTS veto_details text;
ALTER TABLE public.war_room_audits
  ADD COLUMN IF NOT EXISTS final_decision text;
ALTER TABLE public.war_room_audits
  ADD COLUMN IF NOT EXISTS technical_score integer;
ALTER TABLE public.war_room_audits
  ADD COLUMN IF NOT EXISTS ai_confidence numeric;

UPDATE public.war_room_audits
SET symbol = coalesce(nullif(trim(symbol), ''), 'UNKNOWN')
WHERE symbol IS NULL;

ALTER TABLE public.war_room_audits ALTER COLUMN symbol SET DEFAULT 'UNKNOWN';
ALTER TABLE public.war_room_audits ALTER COLUMN symbol SET NOT NULL;

CREATE INDEX IF NOT EXISTS war_room_audits_user_created_idx
  ON public.war_room_audits (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS war_room_audits_symbol_created_idx
  ON public.war_room_audits (symbol, created_at DESC);

COMMENT ON TABLE public.war_room_audits IS 'Per-cycle technical veto trace + final decision.';
COMMENT ON COLUMN public.war_room_audits.veto_details IS 'JSON text: veto_reasons[], scorecard, sentiment_fear_greed, hold reason, overrides.';
