-- DB-backed LLM credential pool (optional: enable Edge secret `LLM_API_KEYS_DB=1`).
-- Rollback: DROP TABLE IF EXISTS public.llm_api_keys CASCADE; DROP FUNCTION IF EXISTS ... ;

CREATE TYPE public.llm_provider AS ENUM ('gemini', 'groq');

CREATE TYPE public.llm_api_key_status AS ENUM ('active', 'cooldown', 'blocked');

CREATE TABLE IF NOT EXISTS public.llm_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider public.llm_provider NOT NULL,
  api_key text NOT NULL,
  status public.llm_api_key_status NOT NULL DEFAULT 'active',
  cooldown_until timestamptz,
  error_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT llm_api_keys_api_key_nonempty CHECK (length(trim(api_key)) > 0),
  CONSTRAINT llm_api_keys_error_count_nonneg CHECK (error_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS llm_api_keys_provider_key_md5_uid
  ON public.llm_api_keys (provider, md5(api_key));

CREATE INDEX IF NOT EXISTS llm_api_keys_provider_status_cooldown_idx
  ON public.llm_api_keys (provider, status, cooldown_until);

CREATE INDEX IF NOT EXISTS llm_api_keys_provider_last_used_idx
  ON public.llm_api_keys (provider, last_used_at ASC NULLS FIRST);

COMMENT ON TABLE public.llm_api_keys IS
  'Optional LLM keys; Edge uses when LLM_API_KEYS_DB=1. Service role only.';

ALTER TABLE public.llm_api_keys ENABLE ROW LEVEL SECURITY;

-- Eligible rows: not blocked, cooldown window elapsed (or never set).
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
  ORDER BY k.last_used_at ASC NULLS FIRST;
$$;

CREATE OR REPLACE FUNCTION public.llm_api_key_record_429(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.llm_api_keys
  SET
    status = 'cooldown',
    cooldown_until = now() + interval '15 minutes',
    error_count = error_count + 1,
    updated_at = now()
  WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.llm_api_key_record_blocked(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.llm_api_keys
  SET
    status = 'blocked',
    cooldown_until = NULL,
    error_count = error_count + 1,
    updated_at = now()
  WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.llm_api_key_touch_used(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.llm_api_keys
  SET
    last_used_at = now(),
    updated_at = now(),
    status = CASE WHEN status = 'cooldown' THEN 'active'::public.llm_api_key_status ELSE status END,
    cooldown_until = CASE WHEN status = 'cooldown' THEN NULL ELSE cooldown_until END
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.llm_api_keys_fetch_available(public.llm_provider) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.llm_api_key_record_429(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.llm_api_key_record_blocked(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.llm_api_key_touch_used(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.llm_api_keys_fetch_available(public.llm_provider) TO service_role;
GRANT EXECUTE ON FUNCTION public.llm_api_key_record_429(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.llm_api_key_record_blocked(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.llm_api_key_touch_used(uuid) TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.llm_api_keys TO service_role;
