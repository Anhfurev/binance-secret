-- 1) bot_debug_traces: columns expected by run-symbol-batch upsert (phase2 may not have run on all envs)
ALTER TABLE public.bot_debug_traces
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bot_id uuid,
  ADD COLUMN IF NOT EXISTS cycle_id text;

-- 2) Dedupe before unique index (keep newest row per cycle/symbol/user)
DELETE FROM public.bot_debug_traces t
WHERE t.ctid IN (
  SELECT ctid FROM (
    SELECT ctid,
           row_number() OVER (
             PARTITION BY cycle_id, symbol, user_id
             ORDER BY created_at DESC NULLS LAST, id DESC
           ) AS rn
    FROM public.bot_debug_traces
    WHERE cycle_id IS NOT NULL AND user_id IS NOT NULL
  ) s
  WHERE s.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS bot_debug_traces_cycle_symbol_user_uniq
  ON public.bot_debug_traces (cycle_id, symbol, user_id)
  WHERE cycle_id IS NOT NULL AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bot_debug_traces_bot_id_created_at_idx
  ON public.bot_debug_traces (bot_id, created_at DESC);

-- 3) Explicit AI cache invalidation (replaces fragile updated_at + boolean heuristics in Edge)
ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS ai_cache_invalidate_until timestamptz;

-- PostgREST picks up new columns without waiting for cache TTL
NOTIFY pgrst, 'reload schema';
