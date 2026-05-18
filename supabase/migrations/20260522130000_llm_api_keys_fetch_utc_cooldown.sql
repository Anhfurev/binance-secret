-- Reinforce llm_api_keys fetch: never return rows with future cooldown_until (UTC timestamptz).
-- Rollback: restore function from 20260517130000_llm_api_keys_fetch_order.sql

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
    AND (k.cooldown_until IS NULL OR k.cooldown_until < now())
    AND (
      (k.status = 'active' AND (k.cooldown_until IS NULL OR k.cooldown_until < now()))
      OR (
        k.status = 'cooldown'
        AND k.cooldown_until IS NOT NULL
        AND k.cooldown_until < now()
      )
    )
  ORDER BY k.cooldown_until ASC NULLS FIRST, k.last_used_at ASC NULLS FIRST, k.created_at ASC;
$$;

COMMENT ON FUNCTION public.llm_api_keys_fetch_available(public.llm_provider) IS
  'Eligible llm_api_keys: blocked excluded; cooldown_until must be NULL or past now() (UTC timestamptz).';
