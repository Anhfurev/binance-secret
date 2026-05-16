// @ts-nocheck
import { DEFAULT_MIN_AI_CONFIDENCE, DEFAULT_MIN_TECH_SCORE } from "./constants.ts";
import type { AiAnalysis, IndicatorSnapshot, SignalDecision } from "./types.ts";
import { GLOBAL_BOT_CONFIG } from "./config.ts";
import { passesMeanReversionBuyGate } from "./regime-detection.ts";
import { evaluateNoTradeStrategyScoutBuy } from "./no-trade-fallback.ts";
import { allowsAdaptiveNeutralRsiBuy } from "./strategy-hybrid-gates.ts";
import type { RegimeGatePolicy } from "./dynamic-regime-switcher.ts";

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
  /** Prior consecutive cycles with weak bid/ask imbalance (open position). */
  orderBookImbalanceExitWeakStreak?: number;
  openTradeOpenedAt?: string | null;
  noTradeScoutActive?: boolean;
  /** BB+RSI dip line: from `resolveStrategyBuyRsiMax(row)` vs `GLOBAL_BOT_CONFIG.STRATEGY_BUY_RSI_THRESHOLD`. */
  strategyBuyRsiThreshold?: number;
  /** Paper-only: softer ranging scout + strategy exploration path (not used for live). */
  paperExploration?: boolean;
  strategyReason?: string | null;
  /** Deep oversold bounce: skip EMA200 macro gate when true. */
  oversoldBounceActive?: boolean;
  gatePolicy?: RegimeGatePolicy | null;
}): {
  decision: SignalDecision;
  reason: string;
  orderBookImbalanceWeakStreak?: number;
} {
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
    orderBookImbalanceMinHoldMs = 120_000,
    orderBookImbalanceExitWeakStreak = 0,
    openTradeOpenedAt = null,
    noTradeScoutActive = false,
    paperExploration = false,
    strategyBuyRsiThreshold = GLOBAL_BOT_CONFIG.STRATEGY_BUY_RSI_THRESHOLD,
    strategyReason = null,
    oversoldBounceActive = false,
    gatePolicy = null,
  } = params;

  const withObStreak = (result: { decision: SignalDecision; reason: string }) => (
    hasOpenTrade
      ? { ...result, orderBookImbalanceWeakStreak: orderBookImbalanceWeakStreakNext }
      : result
  );

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
    if (gatePolicy?.regime === "REGIME_SIDEWAYS" && strategySignal === "BUY") {
      return null;
    }
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
    if (
      allowsAdaptiveNeutralRsiBuy({
        rsi,
        aiConfidence: Number(ai.ai_confidence),
        strategyBuyRsiThreshold,
        marketRegime,
        strategySignal,
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
  const aggressiveAiFloor = aggressiveModeEnabled
    ? Math.max(42, minAiConfidence - 15)
    : minAiConfidence;
  const hasAggressiveConfidence =
    Number.isFinite(aiConf) &&
    aiConf >= aggressiveAiFloor &&
    ai.trend !== "bearish" &&
    ai.groq_verdict !== "REJECT";
  const hasExtremeAggressiveException =
    hasAggressiveConfidence &&
    aiConf > 88 &&
    Number.isFinite(imbalanceRatio) &&
    imbalanceRatio > 0.8;
  const aggressiveTechFloor = aggressiveModeEnabled
    ? minTechnicalScore
    : Math.max(5, minTechnicalScore + 1);
  const passesAggressiveTechGate =
    technicalScore >= aggressiveTechFloor || hasExtremeAggressiveException;
  const tieBreakerQualityBuy =
    strategySignal === "BUY" &&
    technicalScore >= Math.max(7, minTechnicalScore + 1) &&
    Number.isFinite(aiConf) &&
    aiConf >= Math.max(48, minAiConfidence - 3) &&
    ai.groq_verdict !== "REJECT" &&
    ai.trend !== "bearish";
  const isMemeSymbol = /PEPE|BONK|WIF|FLOKI|MEME/i.test(symbol);
  const memeVolatilityOverride =
    isMemeSymbol &&
    volumeSpike &&
    memeSentimentSupport &&
    technicalScore >= 6 &&
    Number.isFinite(aiConf) &&
    aiConf >= 55 &&
    rsi < 70 &&
    ai.groq_verdict !== "REJECT" &&
    ai.trend !== "bearish";

  const obExitThresh = Number.isFinite(orderBookImbalanceExitBelow) &&
      orderBookImbalanceExitBelow > 0 &&
      orderBookImbalanceExitBelow < 0.99
    ? orderBookImbalanceExitBelow
    : 0.32;
  const weakObSample = hasOpenTrade &&
    marketRegime !== "RANGING" &&
    Number.isFinite(imbalanceRatio) &&
    imbalanceRatio < obExitThresh;
  const orderBookImbalanceWeakStreakNext = weakObSample
    ? orderBookImbalanceExitWeakStreak + 1
    : 0;

  if (strategyExitTriggered || strategySignal === "SELL") {
    return withObStreak({ decision: "SELL", reason: "strategy_exit_or_signal_sell" });
  }
  if (
    hasOpenTrade &&
    ai.trend === "bearish" &&
    technical === "SELL" &&
    Number.isFinite(aiConf) &&
    aiConf > 85
  ) {
    return withObStreak({ decision: "SELL", reason: "ai_panic_sell" });
  }
  const isImbalanceExitTemporarilyDisabled =
    Number.isFinite(Number(orderBookImbalanceExitDisabledUntilMs)) &&
    Date.now() < Number(orderBookImbalanceExitDisabledUntilMs);
  if (
    !isImbalanceExitTemporarilyDisabled &&
    hasOpenTrade &&
    marketRegime !== "RANGING" &&
    obImbalanceHoldElapsed &&
    orderBookImbalanceWeakStreakNext >= 3
  ) {
    return withObStreak({ decision: "SELL", reason: "Order Book Imbalance Exit" });
  }
  if (strategySignal === "BUY" && hasOpenTrade) {
    return withObStreak({ decision: "HOLD", reason: "hold_open_position" });
  }

  if (strategySignal === "BUY") {
    if (technicalScore <= 0 && !aggressiveModeEnabled) {
      return { decision: "HOLD", reason: "hold_zero_technical_score" };
    }
    const highConfidenceAiOverride =
      aggressiveModeEnabled &&
      hasAggressiveConfidence &&
      ai.action === "BUY" &&
      passesAggressiveTechGate;
    const dipBuyConfidenceOverride =
      Number.isFinite(rsi) &&
      rsi < strategyBuyRsiThreshold &&
      technicalScore > 8 &&
      Number.isFinite(aiConf) &&
      aiConf >= Math.max(55, minAiConfidence - 15) &&
      ai.groq_verdict !== "REJECT";
    const oversoldBounceTechOk = Boolean(oversoldBounceActive) &&
      strategyReason === "strategy_oversold_bounce_entry";
    const adaptiveNeutralRsiOk = allowsAdaptiveNeutralRsiBuy({
      rsi,
      aiConfidence: aiConf,
      strategyBuyRsiThreshold,
      marketRegime,
      strategySignal,
    });
    if (
      technicalScore < minTechnicalScore &&
      (!aggressiveModeEnabled || !highConfidenceAiOverride) &&
      !tieBreakerQualityBuy &&
      !memeVolatilityOverride &&
      !oversoldBounceTechOk &&
      !adaptiveNeutralRsiOk
    ) {
      return { decision: "HOLD", reason: "hold_technical_score_gate" };
    }
    if (tieBreakerQualityBuy) {
      return { decision: "BUY", reason: "tie_breaker_quality_buy" };
    }
    if (memeVolatilityOverride) {
      return { decision: "BUY", reason: "meme_volume_sentiment_override" };
    }
    if (!Number.isFinite(aiConf) || aiConf <= 0) {
      return { decision: "HOLD", reason: "strategy_buy_rejected_ai_call_failed" };
    }
    if (dipBuyConfidenceOverride) {
      return { decision: "BUY", reason: "oversold_dip_buy_confidence_override" };
    }
    if (adaptiveNeutralRsiOk && aiConf >= minAiConfidence && ai.groq_verdict !== "REJECT" && ai.trend !== "bearish") {
      return { decision: "BUY", reason: "hybrid_adaptive_neutral_rsi_buy" };
    }
    if (aiConf < minAiConfidence) {
      return { decision: "HOLD", reason: "strategy_buy_rejected_low_conviction" };
    }
    if (ai.action !== "BUY") {
      if (ai.groq_verdict === "REJECT") {
        return {
          decision: "HOLD",
          reason: `Vetoed by Groq: ${ai.groq_reason ?? "No reason provided"}`,
        };
      }
      if (
        ai.action === "HOLD" &&
        Number.isFinite(aiConf) &&
        aiConf >= minAiConfidence + (aggressiveModeEnabled ? 5 : 0) &&
        technicalScore >= minTechnicalScore + (aggressiveModeEnabled ? 1 : 0) &&
        technical !== "SELL" &&
        ai.trend !== "bearish"
      ) {
        if (!aggressiveModeEnabled && !ai.trend_alignment) {
          return { decision: "HOLD", reason: "hold_ai_trend_not_aligned" };
        }
        if (!aggressiveModeEnabled && isBelowEma200 && !oversoldBounceActive) {
          return { decision: "HOLD", reason: "hold_ema200_gate" };
        }
        if (marketRegime === "RANGING" && isBreakout) {
          return { decision: "HOLD", reason: "hold_regime_mismatch" };
        }
        if (
          marketRegime === "TRENDING" &&
          technical !== "BUY" &&
          technicalScore < minTechnicalScore + 2 &&
          !oversoldBounceActive
        ) {
          return { decision: "HOLD", reason: "hold_regime_mismatch" };
        }
        const rangingHold = rangingMeanReversionBlock();
        if (rangingHold) return rangingHold;
        return { decision: "BUY", reason: "strategy_confirmed_high_conviction_buy" };
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
    if (!aggressiveModeEnabled && isBelowEma200 && !oversoldBounceActive) {
      return { decision: "HOLD", reason: "hold_ema200_gate" };
    }
    if (marketRegime === "RANGING" && isBreakout) {
      return { decision: "HOLD", reason: "hold_regime_mismatch" };
    }
    if (
      marketRegime === "TRENDING" &&
      technical !== "BUY" &&
      (!aggressiveModeEnabled || !highConfidenceAiOverride) &&
      !oversoldBounceActive
    ) {
      return { decision: "HOLD", reason: "hold_regime_mismatch" };
    }
    const rangingHold = rangingMeanReversionBlock();
    if (rangingHold) return rangingHold;
    if (oversoldBounceTechOk) {
      return { decision: "BUY", reason: "oversold_bounce_confirmed_buy" };
    }
    return { decision: "BUY", reason: "hybrid_confirmed_buy" };
  }

  // Orderbook imbalance override — requires the SAME conviction bar as the
  // other aggressive overrides (conf >= minAiConfidence AND non-bearish trend), plus a
  // technical floor (score >= 6) unless the extreme exception is satisfied.
  if (
    aggressiveModeEnabled &&
    !hasOpenTrade &&
    Number.isFinite(imbalanceRatio) &&
    imbalanceRatio > 1.15 &&
    hasAggressiveConfidence
  ) {
    if (!passesAggressiveTechGate) {
      return { decision: "HOLD", reason: "aggressive_buy_rejected_low_tech" };
    }
    const rangingHoldOb = rangingMeanReversionBlock();
    if (rangingHoldOb) return rangingHoldOb;
    return { decision: "BUY", reason: "aggressive_buy_confirmed_orderbook" };
  }

  const aggressiveBuyIntent =
    ai.action === "BUY" ||
    (
      ai.action === "HOLD" &&
      (
        ai.trend_alignment ||
        technicalScore >= aggressiveTechFloor ||
        (Number.isFinite(imbalanceRatio) && imbalanceRatio >= 0.55)
      )
    );

  if (
    aggressiveModeEnabled &&
    !hasOpenTrade &&
    aggressiveBuyIntent &&
    hasAggressiveConfidence &&
    technicalScore >= minTechnicalScore
  ) {
    if (!passesAggressiveTechGate) {
      return { decision: "HOLD", reason: "aggressive_buy_rejected_low_tech" };
    }
    const rangingHoldAg = rangingMeanReversionBlock();
    if (rangingHoldAg) return rangingHoldAg;
    return {
      decision: "BUY",
      reason: ai.action === "BUY" ? "aggressive_buy_confirmed" : "aggressive_buy_confirmed_fallback",
    };
  }

  const scoutBuy = evaluateNoTradeStrategyScoutBuy({
    active: noTradeScoutActive,
    hasOpenTrade,
    strategySignal,
    technical,
    technicalScore,
    minTechnicalScore: minTechnicalScore,
    minAiConfidence,
    marketRegime: String(marketRegime ?? "NEUTRAL"),
    rsi,
    latestPrice,
    bbLower,
    ai,
    paperChopRelaxed: paperExploration,
  });
  if (scoutBuy) return scoutBuy;

  return { decision: "HOLD", reason: "hold_no_strategy_buy" };
}
