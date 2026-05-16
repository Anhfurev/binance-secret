-- Align ai_quota_state with binance-bot ai-db.ts dual schema (legacy scope row + id upsert path).
-- Older DBs may have had CREATE TABLE IF NOT EXISTS skip column adds; PostgREST then misses columns in cache.

ALTER TABLE public.ai_quota_state
  ADD COLUMN IF NOT EXISTS consecutive_gemini_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gemini_cooldown_until timestamptz,
  ADD COLUMN IF NOT EXISTS current_gemini_key_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_groq_key_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gemini_key_cooldowns jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS groq_key_cooldowns jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS id text,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cooldown_until timestamptz,
  ADD COLUMN IF NOT EXISTS current_key_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failure_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.ai_quota_state.current_key_index IS 'Gemini key ring index (new-schema upsert path).';
COMMENT ON COLUMN public.ai_quota_state.current_gemini_key_index IS 'Gemini key ring index (legacy scope row path).';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_quota_state' AND column_name = 'scope'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_quota_state' AND column_name = 'id'
  ) THEN
    UPDATE public.ai_quota_state SET id = scope WHERE id IS NULL AND scope IS NOT NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ai_quota_state_id_unique
  ON public.ai_quota_state (id)
  WHERE id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
