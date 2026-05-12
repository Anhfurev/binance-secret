// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { createOrder } from "./binance.ts";
import { botError, botWarn } from "./bot-debug.ts";
import { formatUnknownError, toStringValue, coinIdFromSymbol } from "./utils.ts";
import type { AiAnalysis, BotSettingsRow, MarketRegime, SignalDecision } from "./types.ts";
import { takeProfitDistanceUp, buildAiReasoningJson } from "./buy-helpers.ts";
import { estimatePreSentimentWeightedForRegime } from "./ai-scoring.ts";
import { widenStopLossToDbFloor } from "./trade-stop-risk.ts";
import { resolveBuyContextAndSizing } from "./buy-context.ts";
import { resolveWarRoomOutcome } from "./buy-warroom.ts";
import { prepareBuyExecution } from "./buy-prep.ts";
import { acquireBuyCapitalReservation, releaseBuyCapitalReservation } from "./buy-capital.ts";
import { finalizeBuyExecution } from "./buy-finalize.ts";
import { logBuyFlowFailure } from "./buy-logging.ts";
import { releaseTradeExecutionLock } from "./trade-execution-lock.ts";
import { extractLegFeeUsd, resolveFillVwap } from "./fill-fees.ts";

export async function executeBuyFlow(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  userId: string;
  symbol: string;
  ai: AiAnalysis;
  technical: SignalDecision;
  strategyNotes: string;
  snapshotPrice: number;
  snapshotEma200?: number;
  marketRegime: MarketRegime;
  snapshotRsi: number;
  snapshotBbLower: number;
  adx14: number;
  atr14: number;
  currentBalance: number;
  resolvedStartingBalance: number;
  shouldInitializeStartingBalance: boolean;
  maxDrawdownLimitPct: number;
  trailingStopPct: number;
  cycleId: string;
  volBurstWidenMult?: number;
  volBurstMeta?: Record<string, unknown>;
  snapshotImbalanceRatio?: number;
  snapshotVolume24hQuote?: number | null;
  executionUsdScale?: number;
  demoProbeBuy?: boolean;
  signal?: AbortSignal;
}) {
  const {
    supabase, row, userId, symbol, ai, technical, strategyNotes, snapshotPrice, snapshotEma200,
    marketRegime, snapshotRsi, snapshotBbLower, adx14, atr14, currentBalance,
    resolvedStartingBalance, shouldInitializeStartingBalance, maxDrawdownLimitPct,
    trailingStopPct, cycleId, volBurstWidenMult = 1, volBurstMeta,
    snapshotImbalanceRatio, snapshotVolume24hQuote, executionUsdScale, demoProbeBuy = false, signal,
  } = params;

  const ctx = await resolveBuyContextAndSizing({
    supabase, row, userId, symbol, ai, marketRegime, snapshotPrice, snapshotEma200,
    snapshotRsi, snapshotBbLower, adx14, currentBalance, resolvedStartingBalance,
    maxDrawdownLimitPct, executionUsdScale, demoProbeBuy, signal,
  });
  if (ctx.skipDetail) return { action: "skip" as const, detail: ctx.skipDetail };

  const wr = await resolveWarRoomOutcome({
    supabase,
    row,
    userId,
    symbol,
    ai,
    regime: ctx.regime,
    rawWeighted: ctx.rawWeighted,
    effectiveConfidence: ctx.effectiveConfidence,
    mtf: ctx.mtf,
    bearish1hCap: ctx.bearish1hCap,
    ghostMode: ctx.ghostMode,
    demoProbePaper: ctx.demoProbePaper,
    snapshotImbalanceRatio,
    snapshotVolume24hQuote,
  });
  if (wr.skipDetail) return { action: "skip" as const, detail: wr.skipDetail };

  const prep = await prepareBuyExecution({
    supabase,
    row,
    userId,
    symbol,
    ai,
    marketRegime: ctx.regime,
    snapshotPrice,
    atr14,
    trailingStopPct,
    volBurstWidenMult,
    volBurstMeta,
    tradeUsd: ctx.tradeUsd,
    effectiveConfidence: ctx.effectiveConfidence,
    rawWeighted: ctx.rawWeighted,
    bearish1hCap: ctx.bearish1hCap,
    mtf: ctx.mtf,
    ghostMode: ctx.ghostMode,
    walletUsdt: currentBalance,
  });
  if (prep.skipDetail) return { action: "skip" as const, detail: prep.skipDetail };

  let reservationId: string | null = null;
  let buyOrder: Record<string, unknown> | null = null;
  let buyLockHeld = false;
  const reserveResult = await acquireBuyCapitalReservation({
    supabase,
    userId,
    symbol,
    tradeUsd: ctx.tradeUsd,
    currentBalance,
    effectiveConfidence: ctx.effectiveConfidence,
    rawWeighted: ctx.rawWeighted,
    bearish1hCap: ctx.bearish1hCap,
    aiConfidence: Number(ai.ai_confidence),
    cycleId,
    botId: prep.botId,
    ghostMode: ctx.ghostMode,
    isPaperOnly: ctx.isPaperOnly,
    usdtBalance: prep.usdtBalance,
  });
  if (reserveResult.skipDetail) return { action: "skip" as const, detail: reserveResult.skipDetail };
  reservationId = reserveResult.reservationId ?? null;

  try {
    if (ctx.ghostMode && !prep.exchangeSkipped) {
      botError("buyFlow", "ghost_live_create_order_invariant_broken", { userId, symbol });
      throw new Error("Invariant: ghostMode requires resolveExchangeSkipped");
    }
    buyOrder = await createOrder({
      supabase,
      userId,
      botId: prep.botId ?? undefined,
      cycleId,
      symbol,
      side: "buy",
      amount: prep.qty,
      referencePrice: snapshotPrice,
      marketRegime: ctx.regime,
      isTestMode: ctx.ghostMode ? true : prep.exchangeSkipped,
      signal,
    }) as Record<string, unknown>;
    if ((buyOrder as any)?.idempotent) {
      botWarn("buyFlow", "idempotent_duplicate_block", { userId, symbol, cycleId });
      return { action: "skip" as const, detail: `Duplicate BUY skipped (cycle) for bot=${prep.botId ?? "n/a"} cycle=${cycleId}` };
    }
    buyLockHeld = true;
    const buyOrderId = toStringValue((buyOrder as any)?.exchange_order_id);
    const executedQty = Number((buyOrder as any)?.amount);
    const filledQty = Number.isFinite(executedQty) && executedQty > 0 ? executedQty : prep.qty;
    const entryForDb = resolveFillVwap(buyOrder as Record<string, unknown>, snapshotPrice);
    const feeUsdBuy = extractLegFeeUsd(buyOrder as Record<string, unknown>);
    const valueUsd = Number((filledQty * entryForDb).toFixed(8));
    let stopLossPersist = Number((Math.min(entryForDb * (1 - 1e-8), Math.max(entryForDb - prep.slDistance, entryForDb * 1e-8))).toFixed(8));
    if (!(stopLossPersist < entryForDb)) stopLossPersist = Number((entryForDb * (1 - prep.stopLossPctFraction)).toFixed(8));
    stopLossPersist = widenStopLossToDbFloor(entryForDb, stopLossPersist, prep.stopLossPctFraction);
    const slDistanceAtEntry = entryForDb - stopLossPersist;
    const tpDistanceAtEntry = takeProfitDistanceUp(entryForDb, atr14, Number((row as any)?.take_profit_pct ?? 0) / 100, slDistanceAtEntry);
    const takeProfitPersist = Number((entryForDb + tpDistanceAtEntry).toFixed(8));
    let initialTrailingPersist = Number((Math.min(entryForDb * (1 - 1e-8), Math.max(entryForDb - prep.trailDistance, entryForDb * 1e-8))).toFixed(8));
    if (!(initialTrailingPersist < entryForDb)) initialTrailingPersist = Number((entryForDb * (1 - trailingStopPct)).toFixed(8));
    const weightedPreSentimentVibe = estimatePreSentimentWeightedForRegime(ai, ctx.regime, ctx.resolvedWeights);
    const aiReasoningJson = buildAiReasoningJson(ai, wr.executionConfidence, {
      raw_weighted: ctx.rawWeighted,
      weighted_pre_sentiment_vibe: weightedPreSentimentVibe,
      bearish_1h_cap: ctx.bearish1hCap,
      mtf: ctx.mtf,
      market_regime: ctx.regime,
      adx14,
      score_weight_profile: ctx.scoreWeightProfile,
      resolved_weights: {
        trend: ctx.resolvedWeights.trend,
        momentum: ctx.resolvedWeights.momentum,
        volume: ctx.resolvedWeights.volume,
        order_book: ctx.resolvedWeights.order_book,
      },
      war_room: wr.warRoom,
    });
    const finalized = await finalizeBuyExecution({
      supabase,
      userId,
      symbol,
      ai,
      strategyNotes,
      botId: prep.botId,
      cycleId,
      buyOrderId,
      isTestMode: prep.isTestMode,
      ghostMode: ctx.ghostMode,
      shouldInitializeStartingBalance,
      resolvedStartingBalance,
      currentBalance,
      snapshotPrice,
      requestedQty: prep.qty,
      filledQty,
      entryForDb,
      valueUsd,
      stopLossPersist,
      takeProfitPersist,
      initialTrailingPersist,
      trailingStopPct,
      atr14,
      atrTrailEffective: prep.atrTrailEffective,
      vb: prep.vb,
      volBurstMeta,
      slDistance: prep.slDistance,
      trailDistance: prep.trailDistance,
      effectiveConfidence: ctx.effectiveConfidence,
      rawWeighted: ctx.rawWeighted,
      bearish1hCap: ctx.bearish1hCap,
      aiReasoningJson,
      coinId: coinIdFromSymbol(symbol),
      technical,
      buyOrder: buyOrder as any,
      openedAt: prep.openedAt,
      feeUsdBuy,
    });
    buyLockHeld = false;
    return finalized;
  } catch (error) {
    const detail = formatUnknownError(error);
    const lower = detail.toLowerCase();
    await logBuyFlowFailure({
      supabase,
      userId,
      symbol,
      message: lower.includes("insufficient")
        ? "exchange_insufficient_balance"
        : lower.includes("min notional") || lower.includes("notional")
        ? "exchange_min_notional"
        : lower.includes("slippage_limit_exceeded")
        ? "slippage_limit_exceeded"
        : lower.includes("smart_limit_max_chase_exceeded")
        ? "smart_limit_max_chase_exceeded"
        : lower.includes("smart_limit_no_fill_non_trending")
        ? "smart_limit_no_fill_non_trending"
        : "execute_buy_failed",
      meta: {
        reason: "exchange_or_persist_failure_after_decision_buy",
        detail,
        ai_confidence: Number(ai.ai_confidence),
        weighted_confidence_raw: ctx.rawWeighted,
        weighted_confidence_effective: ctx.effectiveConfidence,
        bearish_1h_cap: ctx.bearish1hCap,
        qty: prep.qty,
        trade_usd: Number(ctx.tradeUsd.toFixed(8)),
        snapshot_price: Number(snapshotPrice.toFixed(8)),
        stage: "create_order_or_insert_trade",
      },
    });
    throw error;
  } finally {
    if (buyLockHeld && prep.botId && cycleId) {
      await releaseTradeExecutionLock({
        supabase,
        botId: String(prep.botId),
        cycleId: String(cycleId),
        side: "buy",
      });
    }
    await releaseBuyCapitalReservation({ supabase, reservationId, userId, symbol });
  }
}
