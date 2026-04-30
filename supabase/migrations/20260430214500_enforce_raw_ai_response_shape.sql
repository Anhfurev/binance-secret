-- Enforce minimum shape for bot_debug_traces.raw_ai_response.
ALTER TABLE public.bot_debug_traces
  DROP CONSTRAINT IF EXISTS bot_debug_traces_raw_ai_response_object_chk;

ALTER TABLE public.bot_debug_traces
  ADD CONSTRAINT bot_debug_traces_raw_ai_response_object_chk
  CHECK (
    raw_ai_response IS NULL OR (
      jsonb_typeof(raw_ai_response) = 'object'
      AND raw_ai_response ? 'schema_version'
      AND raw_ai_response ? 'discriminator'
      AND raw_ai_response ? 'provider'
      AND raw_ai_response ? 'provider_path'
      AND raw_ai_response ? 'cache_status'
      AND raw_ai_response ? 'confidence'
      AND raw_ai_response ? 'gemini_conf'
      AND raw_ai_response ? 'groq_conf'
      AND raw_ai_response ? 'reason'
      AND raw_ai_response ? 'force_buy_reason'
      AND raw_ai_response ? 'perf_metadata'
      AND raw_ai_response ? 'model_response'
      AND raw_ai_response ? 'groq_veto'
      AND (raw_ai_response->>'schema_version')::int = 1
      AND (raw_ai_response->>'discriminator') IN ('cache', 'live', 'timeout')
    )
  );
