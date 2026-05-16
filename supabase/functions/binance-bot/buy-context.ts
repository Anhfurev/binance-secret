// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { AiAnalysis, BotSettingsRow, MarketRegime } from "./types.ts";
import { MIN_TRADE_USD, TRADING_AMOUNT_USD } from "./constants.ts";
import { resolveDrawdownBreachSkip } from "./buy-drawdown-guard.ts";
import { resolveTradeSizeUsd } from "./trade-store.ts";
import {
  applyConfidenceSizedTradeUsd,
  resolveConfidenceTradeUsdScale,
} from "./trade-size-confidence.ts";
import { computeWeightedConfidenceForRegime, getResolvedScoreWeightsPack } from "./ai-scoring.ts";
import { passesMeanReversionBuyGate } from "./regime-detection.ts";
import { resolveBuyFlowMtfContext } from "./buy-mtf.ts";
import {
  ONE_H_BEARISH_MAX_CONFIDENCE,
  readMinAdxForBuyContextGate,
  readPaperWeightedFloorRelaxPoints,
} from "./buy-helpers.ts";
import { resolveConfidencePolicy } from "./confidence-policy.ts";
import { paperLiveStylePracticeEnabled } from "./live-style-practice.ts";
import { applySymbolTradeUsdFloor } from "./trade-size-floor.ts";
import { resolveGhostMode, resolveTestMode } from "./bot-shared.ts";
import {
  resolveTradeRegime,
} from "./regime-scaling.ts";
import {
  getRequiredConfidence,
  TRADING_POLICY,
} from "./config/trading-policy.ts";
import { blockedByStoplossStreakBlacklist } from "./stop-reentry-cooldown.ts";

export async function resolveBuyContextAndSizing(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  userId: string;
  symbol: string;
  ai: AiAnalysis;
  marketRegime: MarketRegime;
  snapshotPrice: number;
  snapshotEma200?: number;
  snapshotRsi: number;
  snapshotBbLower: number;
  adx14: number;
  atr14: number;
  currentBalance: number;
  resolvedStartingBalance: number;
  maxDrawdownLimitPct: number;
  executionUsdScale?: number;
  demoProbeBuy?: boolean;
  signal?: AbortSignal;
}) {
  const {
    supabase, row, userId, symbol, ai, marketRegime, snapshotPrice, snapshotEma200,
    snapshotRsi, snapshotBbLower, adx14, atr14, currentBalance, resolvedStartingBalance,
    maxDrawdownLimitPct, executionUsdScale, demoProbeBuy = false, signal,
  } = params;
  const demoProbePaper =
    Boolean(demoProbeBuy) && !Boolean((row as any)?.is_live_trading_enabled);
  if (signal?.aborted) return { skipDetail: "cycle_aborted" };

  const regime: MarketRegime = marketRegime ?? "NEUTRAL";
  const tradeRegime = resolveTradeRegime(symbol, snapshotPrice, atr14);
  const unifiedPolicyGate = getRequiredConfidence(currentBalance, tradeRegime);
  const confidencePolicy = resolveConfidencePolicy(row as Record<string, unknown>, {
    marketRegime: regime,
    tradeRegime,
  });
  const streakBlacklist = await blockedByStoplossStreakBlacklist({ supabase, userId, symbol });
  if (streakBlacklist.blocked) {
    return { skipDetail: `BUY blocked: ${streakBlacklist.reason ?? "stoploss_streak_blacklist"}` };
  }

  const scoreWeightProfile: "trend_following" | "mean_reversion" =
    regime === "RANGING" ? "mean_reversion" : "trend_following";
  const scorePack = getResolvedScoreWeightsPack(row as Record<string, unknown>);
  const resolvedWeights =
    regime === "RANGING" ? scorePack.mr : scorePack.tf;
  const rawWeighted = computeWeightedConfidenceForRegime(ai, regime, resolvedWeights);

  const drawdownPct = resolvedStartingBalance > 0
    ? ((resolvedStartingBalance - currentBalance) / resolvedStartingBalance) * 100
    : 0;
  const ghostMode = resolveGhostMode(row);
  const isPaperOnly = !Boolean((row as any)?.is_live_trading_enabled);
  let minWeightedEntry = confidencePolicy.execution_weighted_floor;
  if (isPaperOnly && !demoProbePaper) {
    minWeightedEntry = Math.max(
      TRADING_POLICY.confidence.paperWeightedAbsoluteFloor,
      minWeightedEntry - readPaperWeightedFloorRelaxPoints(),
    );
  }
  minWeightedEntry = Math.max(minWeightedEntry, unifiedPolicyGate.minAiConfidence);
  if (!demoProbePaper && rawWeighted < minWeightedEntry) {
    return {
      skipDetail:
        `BUY blocked: weighted conviction ${rawWeighted.toFixed(2)}% < policy floor ${minWeightedEntry}%`,
      rawWeighted,
      resolvedWeights,
      regime,
      scoreWeightProfile,
      ghostMode,
      isPaperOnly,
      demoProbePaper,
      trading_policy_rule_refs: unifiedPolicyGate.policy_rule_refs,
    };
  }
  const holdModelMargin = isPaperOnly
    ? TRADING_POLICY.confidence.holdModelMarginPaper
    : TRADING_POLICY.confidence.holdModelMarginLive;
  if (
    !demoProbePaper &&
    String(ai.action ?? "").toUpperCase() === "HOLD" &&
    rawWeighted < minWeightedEntry + holdModelMargin
  ) {
    return {
      skipDetail:
        `BUY blocked: model action HOLD with weighted conviction ${rawWeighted.toFixed(2)}% below ${minWeightedEntry + holdModelMargin}%`,
      rawWeighted,
      resolvedWeights,
      regime,
      scoreWeightProfile,
      ghostMode,
      isPaperOnly,
      demoProbePaper,
      trading_policy_rule_refs: unifiedPolicyGate.policy_rule_refs,
    };
  }
  const drawdownSkip = await resolveDrawdownBreachSkip({
    supabase,
    userId,
    symbol,
    drawdownPct,
    maxDrawdownLimitPct,
    currentBalance,
    resolvedStartingBalance,
    ghostMode,
    isPaperOnly,
  });
  if (drawdownSkip) return drawdownSkip;

  const paperLiveStyle = isPaperOnly && paperLiveStylePracticeEnabled(isPaperOnly);
  const minAdxGate = readMinAdxForBuyContextGate({
    isPaperOnly,
    paperLiveStylePractice: paperLiveStyle,
  });
  if (
    regime !== "TRENDING" &&
    Number.isFinite(adx14) &&
    adx14 < minAdxGate
  ) {
    const minAdx = minAdxGate;
    return {
      skipDetail:
        `BUY blocked: regime=${regime} with ADX(14)=${adx14.toFixed(2)} < ${minAdx}. Chop is wider than the SL distance — wait for trending follow-through.`,
      rawWeighted,
      resolvedWeights,
      regime,
      scoreWeightProfile,
      ghostMode,
      isPaperOnly,
      demoProbePaper,
    };
  }
  const rangingMrOk = passesMeanReversionBuyGate({
    regime,
    rsi: snapshotRsi,
    latestPrice: snapshotPrice,
    bbLower: snapshotBbLower,
  });
  const paperRangingBypass =
    isPaperOnly &&
    !demoProbePaper &&
    regime === "RANGING" &&
    !rangingMrOk &&
    rawWeighted >= TRADING_POLICY.confidence.paperRangingBypassMinWeighted &&
    String(Deno.env.get("PAPER_RANGING_MR_BYPASS") ?? "1").trim() !== "0";
  if (regime === "RANGING" && !rangingMrOk && !paperRangingBypass) {
    return {
      skipDetail:
        "BUY blocked: RANGING regime (ADX<20 + tight BB) — require mean-reversion (RSI<40, RSI<32, or price at lower BB); avoids trend-chasing in chop.",
      rawWeighted,
      resolvedWeights,
      regime,
      scoreWeightProfile,
      ghostMode,
      isPaperOnly,
      demoProbePaper,
    };
  }

  const isTestMode = resolveTestMode(row);
  const { bearish1hCap, mtf, mtfDataRejected } = await resolveBuyFlowMtfContext({
    supabase,
    userId,
    symbol,
    isTestMode: isTestMode && !ghostMode,
    snapshotPrice,
    snapshotEma200,
    signal,
  });
  const strictMtfBlock = (!isTestMode || ghostMode) && mtfDataRejected;
  if (strictMtfBlock) {
    return {
      skipDetail:
        "BUY blocked: live MTF guard requires valid 1h OHLCV (≥201 bars) and EMA200; fetch failed or data insufficient (No Data = No Trade).",
      rawWeighted,
      resolvedWeights,
      regime,
      scoreWeightProfile,
      ghostMode,
      isPaperOnly,
      demoProbePaper,
      isTestMode,
      mtf,
    };
  }

  const effectiveConfidence = bearish1hCap
    ? Math.min(rawWeighted, ONE_H_BEARISH_MAX_CONFIDENCE)
    : rawWeighted;

  const minAiConfidenceBuy = isPaperOnly && !demoProbePaper
    ? minWeightedEntry
    : Math.max(confidencePolicy.execution_weighted_floor, unifiedPolicyGate.minAiConfidence);
  if (!demoProbePaper && effectiveConfidence < minAiConfidenceBuy) {
    return {
      skipDetail:
        `BUY blocked: effective confidence ${effectiveConfidence.toFixed(2)}% < policy floor ${minAiConfidenceBuy}% (${tradeRegime})`,
      rawWeighted,
      resolvedWeights,
      regime,
      scoreWeightProfile,
      ghostMode,
      isPaperOnly,
      demoProbePaper,
      isTestMode,
      mtf,
      effectiveConfidence,
      bearish1hCap,
      tradeRegime,
      trading_policy_rule_refs: unifiedPolicyGate.policy_rule_refs,
    };
  }

  const fixedUsd = Number((row as any)?.trade_size_usd ?? (row as any)?.fixed_trade_usd ?? 0);
  const envTradingAmount = Number(Deno.env.get("TRADING_AMOUNT") ?? TRADING_AMOUNT_USD ?? 0);
  const useEnvTradeAmount = fixedUsd <= 0 && envTradingAmount > 0;
  let baseTradeUsd = useEnvTradeAmount
    ? Math.min(currentBalance, Math.max(MIN_TRADE_USD, envTradingAmount))
    : resolveTradeSizeUsd(row, currentBalance);
  if (!Number.isFinite(baseTradeUsd) || baseTradeUsd < MIN_TRADE_USD) {
    baseTradeUsd = Math.min(currentBalance, MIN_TRADE_USD);
  }
  baseTradeUsd = Math.min(currentBalance, Math.max(MIN_TRADE_USD, baseTradeUsd));

  const confidenceSizing = resolveConfidenceTradeUsdScale({
    aiConfidence: Number(ai.ai_confidence),
    weightedConfidence: effectiveConfidence,
    minAiConfidence: minAiConfidenceBuy,
  });
  const tradeUsd = applySymbolTradeUsdFloor({
    symbol,
    tradeUsd: applyConfidenceSizedTradeUsd({
      baseTradeUsd,
      currentBalance,
      minTradeUsd: MIN_TRADE_USD,
      sizing: confidenceSizing,
      executionUsdScale,
      useConfidenceScale: !useEnvTradeAmount && fixedUsd <= 0,
    }),
    currentBalance,
  });
  if (tradeUsd < MIN_TRADE_USD) {
    return {
      skipDetail: `Balance too low for BUY (${currentBalance.toFixed(2)})`,
      rawWeighted,
      resolvedWeights,
      regime,
      scoreWeightProfile,
      ghostMode,
      isPaperOnly,
      demoProbePaper,
      isTestMode,
      mtf,
      effectiveConfidence,
      bearish1hCap,
      tradeUsd,
      baseTradeUsd,
      confidenceSizing,
    };
  }

  return {
    regime,
    scoreWeightProfile,
    resolvedWeights,
    rawWeighted,
    effectiveConfidence,
    ghostMode,
    isPaperOnly,
    demoProbePaper,
    isTestMode,
    mtf,
    bearish1hCap,
    tradeUsd,
    baseTradeUsd,
    confidenceSizing,
    tradeRegime,
    confidencePolicy,
    trading_policy_rule_refs: unifiedPolicyGate.policy_rule_refs,
    trading_policy_unified_min_ai: unifiedPolicyGate.minAiConfidence,
  };
}
