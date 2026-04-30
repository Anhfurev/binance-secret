// @ts-nocheck
// NOTE: The legacy `IS_TEST_MODE = true` hardcode has been removed.
// Test vs live mode is now derived per-bot from `bot_settings.is_live_trading_enabled`
// via `resolveTestMode(row)` in `bot-shared.ts`. Only enable live trading from the
// DB flag; never via a global toggle here.

export const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ??
  "";

export const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("DB_SERVICE_ROLE_KEY") ??
  "";

export const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

export const BINANCE_BASE_URL = "https://api.binance.com";

export const DEFAULT_SYMBOL = "BTCUSDT";
export const SUPPORTED_SYMBOLS = ["BTCUSDT", "PEPEUSDT", "SOLUSDT"] as const;
export const KLINE_INTERVAL = "1m";
export const KLINE_LIMIT = 120;

export const RSI_PERIOD = 14;
/** Wilder ATR length for volatility-adjusted SL / trailing. */
export const ATR_PERIOD = 14;
/** Stop and trail distance = this × ATR (price units). */
export const ATR_STOP_TRAIL_MULTIPLIER = 1.5;
/**
 * Proactive vol-burst guard: multiply effective ATR trail/SL by `1 + score × this`
 * when BB bandwidth tightens and 1m volume dries (see `volatility-burst-predictor.ts`).
 */
export const VOL_BURST_MAX_ATR_BONUS = 0.32;
export const EMA_FAST_PERIOD = 20;
export const EMA_SLOW_PERIOD = 50;

export const DEFAULT_MIN_AI_CONFIDENCE = 78;
/** Inclusive minimum technical score (1–10) when `bot_settings.min_tech_score` is null. Legacy gate was score > 4 → 5. */
export const DEFAULT_MIN_TECH_SCORE = 5;

export const DEFAULT_RISK_PERCENT = 5;
export const DEFAULT_BUY_RSI = 30;
export const DEFAULT_SELL_RSI = 70;

export const MIN_TRADE_USD = 10;
export const PEPE_TEST_TRADE_USD = 20;
export const TRADING_AMOUNT_USD = Number(Deno.env.get("TRADING_AMOUNT") ?? "0");

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-binance-bot-secret",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

