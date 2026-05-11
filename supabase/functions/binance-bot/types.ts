// @ts-nocheck
import type { SentimentVibeMeta } from "./sentiment-check.ts";

export type JsonRecord = Record<string, unknown>;

export type BotSettingsRow = JsonRecord & {
  id?: string;
  user_id?: string;
  is_autopilot_enabled?: boolean;
  is_live_trading_enabled?: boolean;
  /** Shadow runs: persist trades, skip exchange (can be true while is_live_trading_enabled is true). */
  is_ghost_execution?: boolean;
  is_aggressive_mode?: boolean;
  symbol?: string;
  risk_percent?: number;
  trade_size_usd?: number;
  fixed_trade_usd?: number;
  rsi_buy_threshold?: number;
  rsi_sell_threshold?: number;
  stop_loss_pct?: number;
  take_profit_pct?: number;
  /**
   * Minimum net take-profit % (take_profit_pct minus est. round-trip taker fees) to allow BUY.
   * Null → Edge default; 0 disables the extra gate.
   */
  min_profit_after_fees_pct?: number | null;
  trailing_stop_pct?: number;
  min_ai_confidence?: number;
  /** Optional BUY floor when `marketRegime === "TRENDING"`; null → use `min_ai_confidence`. */
  min_ai_confidence_trending?: number | null;
  /** Optional BUY floor when `marketRegime === "RANGING"`; null → use `min_ai_confidence`. */
  min_ai_confidence_ranging?: number | null;
  /** Learned trend-following score weights (monthly correlation job); null → code defaults. */
  score_weights_tf?: Record<string, unknown> | null;
  /** Learned mean-reversion score weights; null → code defaults. */
  score_weights_mr?: Record<string, unknown> | null;
  score_weights_updated_at?: string | null;
  /** Last monthly TF weight learning run (falls back to `score_weights_updated_at` if null). */
  score_weights_tf_updated_at?: string | null;
  /** Last monthly MR weight learning run (falls back to `score_weights_updated_at` if null). */
  score_weights_mr_updated_at?: string | null;
  max_open_trades?: number;
  /**
   * Inclusive minimum technical score (1–10) for BUY / AI gate; null → default 5 (legacy >4).
   * Tune down when `war_room_audits` shows persistent FAIL_TECH_SCORE.
   */
  min_tech_score?: number | null;
  /** Optional 24h quote-volume floor. 0 disables preflight FAIL_VOLUME for sandbox/ghost. */
  min_volume_24h_quote?: number | null;
  /** When set in the future, Edge skips `ai_cache` reads until this instant (UTC). */
  ai_cache_invalidate_until?: string | null;
  /** Optional basket tier for capital allocation hints (see `portfolio-basket.ts`). */
  portfolio_tier?: string | null;
  /** Optional weight 0–100 for basket sizing; null → symbol-based defaults. */
  basket_weight_pct?: number | null;
};

export type ProfileRow = JsonRecord & {
  id?: string;
  demo_balance?: number;
  starting_balance?: number;
  max_drawdown_limit?: number;
};

export type BotPerformanceRow = JsonRecord & {
  id?: string;
  user_id?: string;
  symbol?: string;
  total_trades?: number;
  win_count?: number;
  loss_count?: number;
  total_pnl_usd?: number;
  win_rate_pct?: number;
};

export type OpenTradeRow = JsonRecord & {
  id?: string;
  user_id?: string;
  symbol?: string;
  type?: string;
  status?: string;
  entryPrice?: number;
  amount?: number;
  value?: number;
  opened_at?: string;
  /** Absolute TP from `trades` (quoted column `"takeProfit"`). */
  takeProfit?: number;
  /** Absolute SL from `trades` (quoted column `"stopLoss"`). */
  stopLoss?: number;
  /** Optional % stored on the trade row (if present in schema). */
  take_profit_pct?: number;
  extra?: JsonRecord;
};

export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketRegime = "TRENDING" | "RANGING" | "NEUTRAL";

export type IndicatorSnapshot = {
  symbol: string;
  latestPrice: number;
  imbalance_ratio: number;
  candles5: Candle[];
  candles15: Candle[];
  candles15m: Candle[];
  candles1h: Candle[];
  /** Last bars of 4h series for higher-timeframe context (may be empty if fetch short). */
  candles4h: Candle[];
  /** Multi-TF context: strict 1h/4h, faster 15m/1h, and combined trade filter. */
  trend_htf: {
    trend_1h: "bull" | "bear" | "flat";
    trend_4h: "bull" | "bear" | "flat";
    mtf_aligned: boolean;
    trend_15m: "bull" | "bear" | "flat";
    /** 15m vs 1h same direction (or flat) — allows earlier entries when 4h lags. */
    mtf_ltf_aligned: boolean;
    /** Server / risk: true if strict HTF agrees OR 15m/1h agrees. */
    mtf_effective_ok: boolean;
  };
  marketRegime: MarketRegime;
  /** Last ADX(14) on 1h series (same window as `getRegimeDiagnostics`). */
  adx14: number;
  /** Last ATR(14) on 1m series — SL / trailing distance = `ATR_STOP_TRAIL_MULTIPLIER × atr14`. */
  atr14: number;
  dayLow24h: number;
  /** CCXT ticker quote volume (24h) when present — War Room whale context. */
  volume24hQuote?: number | null;
  /** CCXT ticker base volume (24h) when present — smart-filter vs 1m volume. */
  volume24hBase?: number | null;
  /** Top-of-book spread in basis points when bid/ask are available. */
  spreadBps?: number | null;
  avgVolume1m: number;
  rsi: number;
  rsi15m: number;
  bbLower: number;
  bbMiddle: number;
  bbUpper: number;
  ema200: number;
  /** ~50-period EMA on 1m closes — recovery path vs EMA200. */
  ema50: number;
  emaFast: number;
  emaSlow: number;
  macd: { macd: number; signal: number; histogram: number };
  /**
   * ≥1 — proactive widening of ATR-based SL/trail when squeeze precursor fires
   * (`computeVolatilityBurstGuard` on 1m tape).
   */
  volBurstWidenMult?: number;
  volBurstMeta?: Record<string, unknown>;
};

export type SignalDecision = "BUY" | "SELL" | "HOLD";
export type ExitReason =
  | "roi_target_hit"
  | "stoploss_hit"
  | "rsi_overbought"
  | "no_open_trade"
  | "invalid_entry"
  | "hold"
  | "signal_exit";
export type StrategyReason =
  | "freqtrade_bbrsi_entry_confirmed"
  | "freqtrade_bbrsi_exit_signal"
  | "freqtrade_bbrsi_downtrend_filter"
  | "strategy_no_entry_signal"
  | "hybrid_confirmed_buy"
  | "strategy_exit_or_signal_sell"
  | "ai_panic_sell"
  | "hold_ai_confidence_too_low"
  | "hold_ai_bearish"
  | "hold_technical_sell_block"
  | "hold_no_strategy_buy"
  | "hold_open_position"
  | "strategy_trend_momentum_entry";

export type AiTrend = "bullish" | "bearish" | "neutral";
export type AiAction = "BUY" | "SELL" | "HOLD";

/** 0–100 sub-scores from the model (weighted into `ai_confidence` in code). */
export type AiScorecard = {
  trend_score: number;
  momentum_score: number;
  volume_score: number;
  order_book_score: number;
};

export type AiAnalysis = {
  /** Derived: weighted scorecard (not trusted from model verbatim). */
  ai_confidence: number;
  trend: AiTrend;
  trend_alignment: boolean;
  action: AiAction;
  /** 40% — 1h vs 5m direction alignment (model-estimated 0–100). */
  trend_score?: number;
  /** 30% — RSI/MACD posture. */
  momentum_score?: number;
  /** 20% — breakout / volume surge quality. */
  volume_score?: number;
  /** 10% — buy vs sell wall pressure (use payload imbalance / book context). */
  order_book_score?: number;
  /** ≤15 words; surfaced in Telegram + `trades.ai_reasoning` JSON. */
  pro_tip?: string;
  groq_verdict?: "APPROVE" | "REJECT" | "SKIPPED";
  groq_reason?: string;
  raw_ai_response?: unknown;
  raw_groq_veto_response?: unknown;
  ai_provider?: "cache" | "gemini" | "groq" | "openai" | "fallback";
  ai_provider_path?: string;
  ai_cache_status?: "hit" | "miss" | "bypassed";
  ai_cache_age_ms?: number;
  /** Fear & Greed + optional news; BUY may get 0.7× scorecard when extreme fear or hack-style headline. */
  sentiment_vibe?: SentimentVibeMeta & {
    penalty_applied?: boolean;
    penalty_factor?: number;
  };
};

export type DebugRawAiResponse = {
  schema_version: 1;
  discriminator: "cache" | "live" | "timeout";
  provider: string;
  provider_path: string;
  cache_status: string;
  confidence: number | null;
  gemini_conf: number | null;
  groq_conf: number | null;
  reason: string | null;
  force_buy_reason: string | null;
  perf_metadata: Record<string, unknown> | null;
  model_response: unknown | null;
  groq_veto: unknown | null;
  raw_price?: number | null;
  formatted_price?: string | null;
};

export type BotActionResult = {
  userId: string;
  symbol: string;
  decision: SignalDecision;
  action: "buy" | "sell" | "hold" | "error" | "skip";
  detail: string;
  ai?: AiAnalysis;
  indicators?: {
    rsi: number;
    macd: number;
    macdSignal: number;
    emaFast: number;
    emaSlow: number;
    ema200?: number;
    ema50?: number;
  };
  technical?: SignalDecision;
  exit_reason?: ExitReason;
  /** May be `freqtrade_*|hybrid_*` combined for audit trails. */
  strategy_reason?: string;
};

