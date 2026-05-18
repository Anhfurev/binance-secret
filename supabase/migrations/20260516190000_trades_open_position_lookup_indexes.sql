-- Hot path: loadOpenTrade() in trade-store.ts → public.trades
-- Filters: user_id, symbol, status ILIKE 'open', optional extra->>'bot_id', legacy ghost/paper extra.
--
-- Production (2026-05-16): applied with CREATE INDEX CONCURRENTLY via SQL (outside txn).
-- Fresh DBs / replay: non-concurrent IF NOT EXISTS below (small tables; CONCURRENTLY optional).

CREATE INDEX IF NOT EXISTS idx_trades_open_legacy_user_symbol_opened_at
  ON public.trades (user_id, symbol, opened_at DESC)
  WHERE lower(btrim(status)) = 'open'
    AND (extra->>'is_ghost' IS NULL OR extra->>'is_ghost' = 'false')
    AND (
      extra->>'trade_mode' IS NULL
      OR extra->>'trade_mode' IN ('live', 'paper')
    );

CREATE INDEX IF NOT EXISTS idx_trades_open_bot_user_symbol_bot_opened_at
  ON public.trades (user_id, symbol, ((extra->>'bot_id')), opened_at DESC)
  WHERE lower(btrim(status)) = 'open'
    AND (extra->>'bot_id') IS NOT NULL;

COMMENT ON INDEX idx_trades_open_legacy_user_symbol_opened_at IS
  'loadOpenTrade legacy path: user+symbol open rows (non-ghost live/paper), newest first.';

COMMENT ON INDEX idx_trades_open_bot_user_symbol_bot_opened_at IS
  'loadOpenTrade bot-scoped path: user+symbol+bot_id open rows, newest first.';

ANALYZE public.trades;
