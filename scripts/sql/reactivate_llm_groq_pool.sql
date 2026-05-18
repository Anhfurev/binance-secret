-- Reactivate Groq rows in public.llm_api_keys after 401/429 lockout storms.
-- Safe to re-run. Does not change api_key values — only status/cooldown metadata.
-- Rollback: restore from backup or re-block specific ids via llm_api_key_record_blocked.

UPDATE public.llm_api_keys
SET
  status = 'active',
  cooldown_until = NULL,
  error_count = 0,
  updated_at = now()
WHERE provider = 'groq'
  AND status IN ('cooldown', 'blocked');

-- Verify eligible pool (should match row count when cooldown_until cleared):
-- SELECT id, status, cooldown_until, error_count
-- FROM public.llm_api_keys
-- WHERE provider = 'groq'
-- ORDER BY last_used_at ASC NULLS FIRST;
