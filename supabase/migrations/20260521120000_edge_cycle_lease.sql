-- Distributed cron lease: one active edge batch per scope across isolates (replaces in-memory inFlight only).

ALTER TABLE public.ai_quota_state
  ADD COLUMN IF NOT EXISTS edge_cycle_lease_until timestamptz;

COMMENT ON COLUMN public.ai_quota_state.edge_cycle_lease_until IS
  'Lease expiry for binance-bot cron; NULL or past = claimable.';

CREATE OR REPLACE FUNCTION public.try_claim_edge_cycle_lease(
  p_scope text DEFAULT 'global',
  p_ttl_seconds integer DEFAULT 120
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_until timestamptz;
  v_rows integer := 0;
BEGIN
  IF p_scope IS NULL OR length(trim(p_scope)) = 0 THEN
    RETURN false;
  END IF;

  v_until := v_now + make_interval(secs => greatest(30, coalesce(p_ttl_seconds, 120)));

  INSERT INTO public.ai_quota_state (id, edge_cycle_lease_until, updated_at)
  VALUES (p_scope, v_until, v_now)
  ON CONFLICT (id) DO UPDATE
  SET
    edge_cycle_lease_until = EXCLUDED.edge_cycle_lease_until,
    updated_at = EXCLUDED.updated_at
  WHERE public.ai_quota_state.edge_cycle_lease_until IS NULL
     OR public.ai_quota_state.edge_cycle_lease_until < v_now;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

COMMENT ON FUNCTION public.try_claim_edge_cycle_lease(text, integer) IS
  'Atomically claims edge cron lease for p_scope until now()+ttl seconds.';

GRANT EXECUTE ON FUNCTION public.try_claim_edge_cycle_lease(text, integer) TO service_role;
