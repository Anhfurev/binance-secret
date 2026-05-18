-- Prefer keys with earliest cooldown clearance, then LRU (no row limit).
CREATE OR REPLACE FUNCTION public.llm_api_keys_fetch_available(p_provider public.llm_provider)
RETURNS SETOF public.llm_api_keys
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.llm_api_keys k
  WHERE k.provider = p_provider
    AND k.status <> 'blocked'
    AND (
      (k.status = 'active' AND (k.cooldown_until IS NULL OR k.cooldown_until < now()))
      OR (k.status = 'cooldown' AND k.cooldown_until IS NOT NULL AND k.cooldown_until < now())
    )
  ORDER BY k.cooldown_until ASC NULLS FIRST, k.last_used_at ASC NULLS FIRST, k.created_at ASC;
$$;

COMMENT ON FUNCTION public.llm_api_keys_fetch_available(public.llm_provider) IS
  'All eligible LLM keys for provider; ordered cooldown_until ASC (ready first), then last_used_at. No LIMIT.';

-- Rollback: restore ORDER BY from 20260516180000_llm_api_keys.sql (last_used_at only).
