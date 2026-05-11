// @ts-nocheck
import { DEFAULT_MIN_AI_CONFIDENCE, DEFAULT_MIN_TECH_SCORE } from "./constants.ts";
import type { AiAnalysis, SignalDecision } from "./types.ts";

export function formatCycleReason(
  reason: string | undefined,
  ai: AiAnalysis,
  finalDecision: SignalDecision,
  minAiConfidence: number = DEFAULT_MIN_AI_CONFIDENCE,
  minTechnicalScore: number = DEFAULT_MIN_TECH_SCORE,
) {
  if (reason === "hold_ai_confidence_too_low") {
    return `Confidence (${ai.ai_confidence}) < Threshold (${minAiConfidence})`;
  }
  if (reason === "hold_technical_score_gate") {
    return `Technical Score below gate (>=${minTechnicalScore} required)`;
  }
  if (reason === "strategy_buy_rejected_ai_call_failed") {
    return "Strategy BUY rejected: AI call failed (confidence unresolved)";
  }
  if (reason === "strategy_buy_rejected_low_conviction") {
    return `Strategy BUY rejected: AI confidence ${ai.ai_confidence} < ${minAiConfidence}`;
  }
  if (reason === "hold_ai_action_not_buy") return `AI Action is ${ai.action}, expected BUY`;
  if (reason === "hold_ai_trend_not_aligned") return "1m and 15m trend are not aligned";
  if (reason === "hold_technical_sell_block") return "Technical signal blocked BUY";
  if (reason === "hold_technical_bearish_override") return "Skipped: Technical Bearish Override";
  if (reason === "hold_ema200_gate") return "Strict mode: price is below EMA200";
  if (
    reason === "hold_ranging_mean_reversion_required" ||
    (typeof reason === "string" &&
      reason.includes("hold_ranging_mean_reversion_required"))
  ) {
    return "RANGING regime: need oversold/lower-BB dip — trend-chasing buy blocked";
  }
  if (reason === "mtf_misaligned_high_conf_half_position_override") {
    return "MTF 1h/4h misaligned but model confidence >90% — half-size BUY override";
  }
  if (reason === "hybrid_confirmed_buy") return "All filters passed";
  const aggFloor = Math.max(6, minTechnicalScore);
  if (reason === "aggressive_buy_confirmed_orderbook") {
    return `Aggressive BUY confirmed: orderbook override (conf >= ${minAiConfidence}, non-bearish, tech >= ${aggFloor} or extreme exception)`;
  }
  if (reason === "aggressive_buy_confirmed") {
    return `Aggressive BUY confirmed: AI BUY override (conf >= ${minAiConfidence}, non-bearish, tech >= ${aggFloor} or extreme exception)`;
  }
  if (reason === "aggressive_buy_confirmed_fallback") {
    return `Aggressive BUY confirmed: fallback override (conf >= ${minAiConfidence}, non-bearish, tech >= ${aggFloor} or extreme exception)`;
  }
  if (reason === "aggressive_buy_rejected_low_tech") {
    return `Aggressive BUY rejected: technical score < ${aggFloor} without extreme exception (conf > 88 and imbalance > 0.8)`;
  }
  if (reason === "oversold_dip_buy_confidence_override") {
    return `Dip-buy override: RSI < 30, technical score > 8, confidence >= ${minAiConfidence}`;
  }
  if (reason === "tie_breaker_tech8_ai40") {
    return "Tie-break BUY: technical score = 8 and AI confidence > 40";
  }
  if (reason === "meme_volume_sentiment_override") {
    return "Meme volatility override: volume spike + supportive sentiment + tech floor";
  }
  if (
    typeof reason === "string" &&
    reason.startsWith("demo_inactivity_probe_buy")
  ) {
    return "Paper/demo probe BUY: long inactivity — gated BUY path (live trading unchanged)";
  }
  if (reason === "strategy_exit_or_signal_sell") return "Strategy exit triggered SELL";
  if (reason === "ai_panic_sell") return `AI panic sell at confidence ${ai.ai_confidence}`;
  if (reason?.startsWith("runtime_error:")) return reason;
  return reason ?? `Decision resolved as ${finalDecision}`;
}
