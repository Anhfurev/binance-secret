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
  /** Exit when `imbalanceRatio` is below this (default 0.32). Env `ORDER_BOOK_IMBALANCE_EXIT_BELOW` on caller. */
  orderBookImbalanceExitBelow?: number;
  /** Do not fire imbalance exit until this many ms after `openTradeOpenedAt` (default 90_000). */
  orderBookImbalanceMinHoldMs?: number;
  openTradeOpenedAt?: string | null;
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
    orderBookImbalanceExitBelow = 0.32,
    orderBookImbalanceMinHoldMs = 90_000,
    openTradeOpenedAt = null,
  } = params;

  let obImbalanceHoldElapsed = true;
  if (hasOpenTrade && openTradeOpenedAt) {
    const t = Date.parse(openTradeOpenedAt);
    if (Number.isFinite(t)) {
      obImbalanceHoldElapsed = Date.now() - t >= orderBookImbalanceMinHoldMs;
    }
  }

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
  const obExitThresh = Number.isFinite(orderBookImbalanceExitBelow) &&
      orderBookImbalanceExitBelow > 0 &&
      orderBookImbalanceExitBelow < 0.99
    ? orderBookImbalanceExitBelow
    : 0.32;
  if (
    !isImbalanceExitTemporarilyDisabled &&
    hasOpenTrade &&
    obImbalanceHoldElapsed &&
    Number.isFinite(imbalanceRatio) &&
    imbalanceRatio < obExitThresh
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
