-- Phase 2: structured JSONB audits + unified bot debug trace keys/indexes.

-- 1) war_room_audits.veto_details: text -> jsonb
ALTER TABLE public.war_room_audits
  ALTER COLUMN veto_details TYPE jsonb
  USING CASE
    WHEN veto_details IS NULL OR btrim(veto_details) = '' THEN '{}'::jsonb
    ELSE veto_details::jsonb
  END;

-- 2) bot_debug_traces identity columns for deterministic per-cycle upsert
ALTER TABLE public.bot_debug_traces
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bot_id uuid,
  ADD COLUMN IF NOT EXISTS cycle_id text;

-- 3) JSONB query acceleration
CREATE INDEX IF NOT EXISTS war_room_audits_veto_details_gin
  ON public.war_room_audits USING gin (veto_details);

CREATE INDEX IF NOT EXISTS bot_debug_traces_raw_ai_response_gin
  ON public.bot_debug_traces USING gin (raw_ai_response);

-- 4) De-duplicate traces per cycle/symbol/user (nullable user rows remain allowed)
CREATE UNIQUE INDEX IF NOT EXISTS bot_debug_traces_cycle_symbol_user_uniq
  ON public.bot_debug_traces (cycle_id, symbol, user_id)
  WHERE cycle_id IS NOT NULL AND user_id IS NOT NULL;
