// @ts-nocheck
import { DEFAULT_MIN_AI_CONFIDENCE, DEFAULT_MIN_TECH_SCORE } from "./constants.ts";
import type { AiAnalysis, IndicatorSnapshot, SignalDecision } from "./types.ts";
import { passesMeanReversionBuyGate } from "./regime-detection.ts";

export function decideHybridMatrix(params: {
  strategySignal: SignalDecision;
  hasOpenTrade: boolean;
  strategyExitTriggered: boolean;
  aggressiveModeEnabled: boolean;
  technical: SignalDecision;
  technicalScore: number;
  rsi: number;
  imbalanceRatio: number;
  marketRegime: IndicatorSnapshot["marketRegime"];
  latestPrice: number;
  bbLower: number;
  isBreakout: boolean;
  isBelowEma200: boolean;
  ai: AiAnalysis;
  /** Effective BUY floor (global or regime-specific from `bot_settings`). */
  minAiConfidence: number;
  /** Inclusive minimum technical score for primary BUY path (from `bot_settings.min_tech_score`). */
  minTechnicalScore?: number;
  symbol?: string;
  volumeSpike?: boolean;
  memeSentimentSupport?: boolean;
  orderBookImbalanceExitDisabledUntilMs?: number | null;
}): { decision: SignalDecision; reason: string } {
  const {
    strategySignal,
    hasOpenTrade,
    strategyExitTriggered,
    aggressiveModeEnabled,
    technical,
    technicalScore,
    rsi,
    imbalanceRatio,
    marketRegime,
    latestPrice,
    bbLower,
    isBreakout,
    isBelowEma200,
    ai,
    minAiConfidence,
    minTechnicalScore = DEFAULT_MIN_TECH_SCORE,
    symbol = "",
    volumeSpike = false,
    memeSentimentSupport = false,
    orderBookImbalanceExitDisabledUntilMs = null,
  } = params;

  const rangingMeanReversionBlock = (): {
    decision: "HOLD";
    reason: string;
  } | null => {
    if (marketRegime !== "RANGING") return null;
    if (
      passesMeanReversionBuyGate({
        regime: marketRegime,
        rsi,
        latestPrice,
        bbLower,
      })
    ) {
      return null;
    }
    return {
      decision: "HOLD",
      reason: "hold_ranging_mean_reversion_required",
    };
  };
  const aiConf = Number(ai.ai_confidence);
  const hasAggressiveConfidence =
    Number.isFinite(aiConf) &&
    aiConf >= minAiConfidence &&
    ai.trend !== "bearish" &&
    ai.groq_verdict !== "REJECT";
  const hasExtremeAggressiveException =
    hasAggressiveConfidence &&
    aiConf > 88 &&
    Number.isFinite(imbalanceRatio) &&
    imbalanceRatio > 0.8;
  const aggressiveTechFloor = Math.max(6, minTechnicalScore);
  const passesAggressiveTechGate =
    technicalScore >= aggressiveTechFloor || hasExtremeAggressiveException;
  const tieBreakerTech8Ai40 =
    technicalScore === 8 &&
    Number.isFinite(aiConf) &&
    aiConf > 40 &&
    ai.groq_verdict !== "REJECT" &&
    ai.trend !== "bearish";
  const isMemeSymbol = /PEPE|BONK|WIF|FLOKI|MEME/i.test(symbol);
  const memeVolatilityOverride =
    isMemeSymbol &&
    volumeSpike &&
    memeSentimentSupport &&
    technicalScore >= 6 &&
    Number.isFinite(aiConf) &&
    aiConf >= 35 &&
    ai.groq_verdict !== "REJECT" &&
    ai.trend !== "bearish";

  if (strategyExitTriggered || strategySignal === "SELL") {
    return { decision: "SELL", reason: "strategy_exit_or_signal_sell" };
  }
  if (hasOpenTrade && ai.trend === "bearish" && Number.isFinite(aiConf) && aiConf > 85) {
    return { decision: "SELL", reason: "ai_panic_sell" };
  }
  const isImbalanceExitTemporarilyDisabled =
    Number.isFinite(Number(orderBookImbalanceExitDisabledUntilMs)) &&
    Date.now() < Number(orderBookImbalanceExitDisabledUntilMs);
  if (
    !isImbalanceExitTemporarilyDisabled &&
    hasOpenTrade &&
    Number.isFinite(imbalanceRatio) &&
    imbalanceRatio < 0.4
  ) {
    return { decision: "SELL", reason: "Order Book Imbalance Exit" };
  }
  if (strategySignal === "BUY" && hasOpenTrade) {
    return { decision: "HOLD", reason: "hold_open_position" };
  }

  if (strategySignal === "BUY") {
    const highConfidenceAiOverride =
      aggressiveModeEnabled &&
      hasAggressiveConfidence &&
      ai.action === "BUY" &&
      passesAggressiveTechGate;
    const dipBuyConfidenceOverride =
      Number.isFinite(rsi) &&
      rsi < 30 &&
      technicalScore > 8 &&
      Number.isFinite(aiConf) &&
      aiConf >= minAiConfidence &&
      ai.groq_verdict !== "REJECT";
    if (
      technicalScore < minTechnicalScore &&
      (!aggressiveModeEnabled || !highConfidenceAiOverride) &&
      !tieBreakerTech8Ai40 &&
      !memeVolatilityOverride
    ) {
      return { decision: "HOLD", reason: "hold_technical_score_gate" };
    }
    if (tieBreakerTech8Ai40) {
      return { decision: "BUY", reason: "tie_breaker_tech8_ai40" };
    }
    if (memeVolatilityOverride) {
      return { decision: "BUY", reason: "meme_volume_sentiment_override" };
    }
    if (!Number.isFinite(aiConf) || aiConf <= 0) {
      return { decision: "HOLD", reason: "strategy_buy_rejected_ai_call_failed" };
    }
    if (aiConf < minAiConfidence) {
      return { decision: "HOLD", reason: "strategy_buy_rejected_low_conviction" };
    }
    if (dipBuyConfidenceOverride) {
      return { decision: "BUY", reason: "oversold_dip_buy_confidence_override" };
    }
    if (ai.action !== "BUY") {
      if (ai.groq_verdict === "REJECT") {
        return {
          decision: "HOLD",
          reason: `Vetoed by Groq: ${ai.groq_reason ?? "No reason provided"}`,
        };
      }
      return { decision: "HOLD", reason: "hold_ai_action_not_buy" };
    }
    if (!aggressiveModeEnabled && !ai.trend_alignment) {
      return { decision: "HOLD", reason: "hold_ai_trend_not_aligned" };
    }
    if (ai.trend === "bearish") {
      return { decision: "HOLD", reason: "hold_ai_bearish" };
    }
    if (technical === "SELL") {
      if (Number.isFinite(aiConf) && aiConf >= 75 && ai.action === "BUY") {
        return { decision: "HOLD", reason: "hold_technical_bearish_override" };
      }
      return { decision: "HOLD", reason: "hold_technical_sell_block" };
    }
    if (!aggressiveModeEnabled && isBelowEma200) {
      return { decision: "HOLD", reason: "hold_ema200_gate" };
    }
    if (marketRegime === "RANGING" && isBreakout) {
      return { decision: "HOLD", reason: "hold_regime_mismatch" };
    }
    if (
      marketRegime === "TRENDING" &&
      technical !== "BUY" &&
      (!aggressiveModeEnabled || !highConfidenceAiOverride)
    ) {
      return { decision: "HOLD", reason: "hold_regime_mismatch" };
    }
    const rangingHold = rangingMeanReversionBlock();
    if (rangingHold) return rangingHold;
    return { decision: "BUY", reason: "hybrid_confirmed_buy" };
  }

  // Orderbook imbalance override — requires the SAME conviction bar as the
  // other aggressive overrides (conf >= minAiConfidence AND non-bearish trend), plus a
  // technical floor (score >= 6) unless the extreme exception is satisfied.
  if (
    aggressiveModeEnabled &&
    !hasOpenTrade &&
    Number.isFinite(imbalanceRatio) &&
    imbalanceRatio > 2.5 &&
    hasAggressiveConfidence
  ) {
    if (!passesAggressiveTechGate) {
      return { decision: "HOLD", reason: "aggressive_buy_rejected_low_tech" };
    }
    const rangingHoldOb = rangingMeanReversionBlock();
    if (rangingHoldOb) return rangingHoldOb;
    return { decision: "BUY", reason: "aggressive_buy_confirmed_orderbook" };
  }

  if (
    aggressiveModeEnabled &&
    !hasOpenTrade &&
    ai.action === "BUY" &&
    hasAggressiveConfidence
  ) {
    if (!passesAggressiveTechGate) {
      return { decision: "HOLD", reason: "aggressive_buy_rejected_low_tech" };
    }
    const rangingHoldAg = rangingMeanReversionBlock();
    if (rangingHoldAg) return rangingHoldAg;
    return { decision: "BUY", reason: "aggressive_buy_confirmed" };
  }

  // Aggressive fallback: allow BUY even when AI action is HOLD/neutral, but
  // require strong conviction (>= minAiConfidence), non-bearish trend, and tech >= 6 unless
  // extreme exception applies (conf > 88 and imbalance > 0.8).
  if (
    aggressiveModeEnabled &&
    !hasOpenTrade &&
    hasAggressiveConfidence
  ) {
    if (!passesAggressiveTechGate) {
      return { decision: "HOLD", reason: "aggressive_buy_rejected_low_tech" };
    }
    const rangingHoldFb = rangingMeanReversionBlock();
    if (rangingHoldFb) return rangingHoldFb;
    return { decision: "BUY", reason: "aggressive_buy_confirmed_fallback" };
  }

  return { decision: "HOLD", reason: "hold_no_strategy_buy" };
}

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
