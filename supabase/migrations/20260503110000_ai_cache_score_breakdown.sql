-- Add the score-breakdown columns expected by `ai-db.ts` (`getRecentAiCache` /
-- `saveAiCache`). Without these, every cycle logs:
--   "[binance-bot] ai_cache read failed: column ai_cache.trend_score does not exist"
-- and the cache is fully bypassed (every cycle re-runs full AI -> latency + cost).

ALTER TABLE public.ai_cache
  ADD COLUMN IF NOT EXISTS trend_score numeric,
  ADD COLUMN IF NOT EXISTS momentum_score numeric,
  ADD COLUMN IF NOT EXISTS volume_score numeric,
  ADD COLUMN IF NOT EXISTS order_book_score numeric,
  ADD COLUMN IF NOT EXISTS sentiment_haircut_applied boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS sentiment_penalty_factor numeric;

CREATE INDEX IF NOT EXISTS ai_cache_symbol_created_at_idx
  ON public.ai_cache (symbol, created_at DESC);
