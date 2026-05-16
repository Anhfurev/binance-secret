-- One-shot ops: clear DB-backed AI cooldowns / failure counters so Edge can rotate keys again.
-- Run in Supabase SQL Editor (or `psql`) against your project — NOT applied automatically by migrations.
-- Safe to run multiple times.

UPDATE public.ai_quota_state
SET
  cooldown_until = NULL,
  consecutive_failures = 0,
  last_failure_at = NULL,
  gemini_cooldown_until = NULL,
  consecutive_gemini_failures = 0,
  gemini_key_cooldowns = '{}'::jsonb,
  groq_key_cooldowns = '{}'::jsonb,
  updated_at = now()
WHERE id IS NOT NULL OR scope IS NOT NULL;

NOTIFY pgrst, 'reload schema';
