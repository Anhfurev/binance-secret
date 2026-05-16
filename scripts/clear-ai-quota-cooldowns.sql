-- Clear AI key cooldown + global Gemini cooldown in Postgres.
-- Table shape varies: legacy uses `scope` + `gemini_cooldown_until`; new path uses `id` + `cooldown_until`.
-- This block only SETs columns that exist (safe on id-only DBs where `scope` was never added or was dropped).

DO $$
DECLARE
  has_scope boolean;
  has_id boolean;
  has_gemini_cooldown_until boolean;
  has_cooldown_until boolean;
  has_consecutive_failures boolean;
  has_consecutive_gemini_failures boolean;
  has_current_key_index boolean;
  has_current_gemini_key_index boolean;
  has_groq_idx boolean;
  has_gemini_json boolean;
  has_groq_json boolean;
  has_updated boolean;
  has_last_failure boolean;
  parts text[] := ARRAY[]::text[];
  sql text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_quota_state' AND column_name = 'scope'
  ) INTO has_scope;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_quota_state' AND column_name = 'id'
  ) INTO has_id;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_quota_state' AND column_name = 'gemini_cooldown_until'
  ) INTO has_gemini_cooldown_until;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_quota_state' AND column_name = 'cooldown_until'
  ) INTO has_cooldown_until;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_quota_state' AND column_name = 'consecutive_failures'
  ) INTO has_consecutive_failures;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_quota_state' AND column_name = 'consecutive_gemini_failures'
  ) INTO has_consecutive_gemini_failures;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_quota_state' AND column_name = 'current_key_index'
  ) INTO has_current_key_index;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_quota_state' AND column_name = 'current_gemini_key_index'
  ) INTO has_current_gemini_key_index;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_quota_state' AND column_name = 'current_groq_key_index'
  ) INTO has_groq_idx;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_quota_state' AND column_name = 'gemini_key_cooldowns'
  ) INTO has_gemini_json;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_quota_state' AND column_name = 'groq_key_cooldowns'
  ) INTO has_groq_json;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_quota_state' AND column_name = 'updated_at'
  ) INTO has_updated;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_quota_state' AND column_name = 'last_failure_at'
  ) INTO has_last_failure;

  IF has_cooldown_until THEN parts := array_append(parts, 'cooldown_until = NULL'); END IF;
  IF has_gemini_cooldown_until THEN parts := array_append(parts, 'gemini_cooldown_until = NULL'); END IF;
  IF has_gemini_json THEN parts := array_append(parts, 'gemini_key_cooldowns = ''{}''::jsonb'); END IF;
  IF has_groq_json THEN parts := array_append(parts, 'groq_key_cooldowns = ''{}''::jsonb'); END IF;
  IF has_consecutive_failures THEN parts := array_append(parts, 'consecutive_failures = 0'); END IF;
  IF has_consecutive_gemini_failures THEN parts := array_append(parts, 'consecutive_gemini_failures = 0'); END IF;
  IF has_current_key_index THEN parts := array_append(parts, 'current_key_index = 0'); END IF;
  IF has_current_gemini_key_index THEN parts := array_append(parts, 'current_gemini_key_index = 0'); END IF;
  IF has_groq_idx THEN parts := array_append(parts, 'current_groq_key_index = 0'); END IF;
  IF has_updated THEN parts := array_append(parts, 'updated_at = now()'); END IF;
  IF has_last_failure THEN parts := array_append(parts, 'last_failure_at = NULL'); END IF;

  IF array_length(parts, 1) IS NULL OR array_length(parts, 1) < 1 THEN
    RAISE NOTICE 'ai_quota_state: no known cooldown columns found; skipping UPDATE';
    RETURN;
  END IF;

  sql := 'UPDATE public.ai_quota_state SET ' || array_to_string(parts, ', ') || ' WHERE true';
  EXECUTE sql;
  RAISE NOTICE 'ai_quota_state cooldown clear applied (has_id=%, has_scope=%)', has_id, has_scope;
END $$;

-- Verify (id-only / new-shape dashboards — no `scope` column):
-- SELECT id, cooldown_until, consecutive_failures, current_key_index, current_groq_key_index,
--        gemini_key_cooldowns, groq_key_cooldowns, updated_at, last_failure_at
-- FROM public.ai_quota_state;

-- Verify (legacy row with `scope`):
-- SELECT scope, gemini_cooldown_until, consecutive_gemini_failures, current_gemini_key_index, current_groq_key_index,
--        gemini_key_cooldowns, groq_key_cooldowns, updated_at
-- FROM public.ai_quota_state;
