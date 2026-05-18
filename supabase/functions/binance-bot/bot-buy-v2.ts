// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { createOrder } from "./binance.ts";
import { isPaperTradingEnvForced } from "./paper-trade-interceptor.ts";
import { botError, botWarn } from "./bot-debug.ts";
import { formatUnknownError, toStringValue, coinIdFromSymbol, clamp, toNumber } from "./utils.ts";
import type { AiAnalysis, BotSettingsRow, MarketRegime, SignalDecision } from "./types.ts";
import { buildAiReasoningJson } from "./buy-helpers.ts";
import { computeAtrExitLevels } from "./atr-exit-targets.ts";
import { validateBuyIndicatorFootprint } from "./indicator-buy-validation.ts";
import { isTransientExchangeError, logCriticalExchangeError } from "./exchange-order-retry.ts";
import type { IndicatorSnapshot } from "./types.ts";
import { estimatePreSentimentWeightedForRegime } from "./ai-scoring.ts";
import { widenStopLossToDbFloor, resolveStopLossPctFraction, resolveTakeProfitPctPoints } from "./trade-stop-risk.ts";
import { MIN_TRADE_USD } from "./constants.ts";
import { scaleTradeUsdByGovernanceConfidence } from "./trade-size-confidence.ts";
import { resolveBuyContextAndSizing } from "./buy-context.ts";
import { resolveWarRoomOutcome } from "./buy-warroom.ts";
import { prepareBuyExecution } from "./buy-prep.ts";
import { acquireBuyCapitalReservation, releaseBuyCapitalReservation } from "./buy-capital.ts";
import { finalizeBuyExecution } from "./buy-finalize.ts";
import { logBuyFlowFailure } from "./buy-logging.ts";
import { releaseTradeExecutionLock } from "./trade-execution-lock.ts";
import { extractLegFeeUsd, resolveFillVwap } from "./fill-fees.ts";
import { qualifiesOversoldBounceRelaxedPath } from "./buy-bounce-floor.ts";
import {
  capBounceTradeUsdToExchangeFree,
  evaluateBounceDispatchBalanceGate,
  fetchExchangeFreeUsdtForBounce,
  isLegacyDbLiveBalanceSkip,
  readOversoldBounceRigidFloorUsd,
} from "./buy-live-wallet-sizing.ts";

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
  takeProfitPctOverride?: number | null;
  indicatorSnapshot?: IndicatorSnapshot;
  matrixBuyReason?: string | null;
}) {
  const {
    supabase, row, userId, symbol, ai, technical, strategyNotes, snapshotPrice, snapshotEma200,
    marketRegime, snapshotRsi, snapshotBbLower, adx14, atr14, currentBalance,
    indicatorSnapshot,
    resolvedStartingBalance, shouldInitializeStartingBalance, maxDrawdownLimitPct,
    trailingStopPct, cycleId, volBurstWidenMult = 1, volBurstMeta,
    snapshotImbalanceRatio, snapshotVolume24hQuote, executionUsdScale, demoProbeBuy = false, signal,
    takeProfitPctOverride = null,
    matrixBuyReason = null,
  } = params;

  if (indicatorSnapshot) {
    const footprint = validateBuyIndicatorFootprint(indicatorSnapshot);
    if (!footprint.ok) {
      botWarn("buyFlow", "invalid_indicator_footprint", {
        userId,
        symbol,
        codes: footprint.codes,
      });
      return { action: "skip" as const, detail: footprint.detail };
    }
  }

  const oversoldBounceExecution = qualifiesOversoldBounceRelaxedPath({
    matrixBuyReason,
    combinedTrace: strategyNotes,
  });

  const ctx = await resolveBuyContextAndSizing({
    supabase, row, userId, symbol, ai, marketRegime, snapshotPrice, snapshotEma200,
    snapshotRsi, snapshotBbLower, adx14, atr14, currentBalance, resolvedStartingBalance,
    maxDrawdownLimitPct, executionUsdScale, demoProbeBuy, signal,
    indicatorSnapshot, matrixBuyReason, combinedStrategyTrace: strategyNotes,
  });

  const liveNotPaper = !ctx.isPaperOnly && !ctx.demoProbePaper && !ctx.ghostMode;
  if (
    ctx.skipDetail &&
    !(oversoldBounceExecution && liveNotPaper && isLegacyDbLiveBalanceSkip(ctx.skipDetail))
  ) {
    return { action: "skip" as const, detail: ctx.skipDetail };
  }

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
    confidencePolicy: ctx.confidencePolicy,
    matrixBuyReason,
    combinedStrategyTrace: strategyNotes,
  });
  if (wr.skipDetail) return { action: "skip" as const, detail: wr.skipDetail };

  const governanceTradeUsd = scaleTradeUsdByGovernanceConfidence({
    tradeUsd: ctx.tradeUsd,
    executionConfidence: wr.executionConfidence,
    effectiveConfidence: ctx.effectiveConfidence,
    minTradeUsd: MIN_TRADE_USD,
    currentBalance,
    preserveNotional: Boolean(ctx.oversoldBounceMatrix),
  });

  let exchangeFreeUsdt = Number(ctx.live_free_usdt ?? 0);
  let dispatchTradeUsd = governanceTradeUsd;
  let bounceDispatchCleared = false;
  if (oversoldBounceExecution && liveNotPaper) {
    exchangeFreeUsdt = await fetchExchangeFreeUsdtForBounce(exchangeFreeUsdt);
    const bounceGate = evaluateBounceDispatchBalanceGate(exchangeFreeUsdt, dispatchTradeUsd);
    if (!bounceGate.success) {
      return { action: "skip" as const, detail: bounceGate.skipDetail ?? "bounce_dispatch_balance_blocked" };
    }
    exchangeFreeUsdt = bounceGate.exchangeFreeUsdt;
    bounceDispatchCleared = true;
    dispatchTradeUsd = capBounceTradeUsdToExchangeFree(dispatchTradeUsd, exchangeFreeUsdt);
    if (!(dispatchTradeUsd >= readOversoldBounceRigidFloorUsd() - 1e-6)) {
      return {
        action: "skip" as const,
        detail:
          `BUY blocked: bounce dispatch notional $${dispatchTradeUsd.toFixed(2)} below $${readOversoldBounceRigidFloorUsd().toFixed(2)} CCXT floor`,
      };
    }
  }

  const liveWalletUsdt = oversoldBounceExecution && exchangeFreeUsdt > 0
    ? exchangeFreeUsdt
    : Number.isFinite(ctx.live_free_usdt) && ctx.live_free_usdt > 0
    ? ctx.live_free_usdt
    : currentBalance;
  const prep = await prepareBuyExecution({
    supabase,
    row,
    userId,
    symbol,
    ai,
    marketRegime: ctx.regime,
    snapshotPrice,
    atr14,
    adx14,
    trailingStopPct,
    volBurstWidenMult,
    volBurstMeta,
    tradeUsd: dispatchTradeUsd,
    effectiveConfidence: ctx.effectiveConfidence,
    rawWeighted: ctx.rawWeighted,
    bearish1hCap: ctx.bearish1hCap,
    mtf: ctx.mtf,
    ghostMode: ctx.ghostMode,
    walletUsdt: liveWalletUsdt,
    takeProfitPctOverride,
    oversoldBounceExchangeFree: oversoldBounceExecution && liveNotPaper
      ? exchangeFreeUsdt
      : null,
  });
  if (
    prep.skipDetail &&
    !(oversoldBounceExecution && liveNotPaper && bounceDispatchCleared &&
      isLegacyDbLiveBalanceSkip(prep.skipDetail))
  ) {
    return { action: "skip" as const, detail: prep.skipDetail };
  }

  if (oversoldBounceExecution && liveNotPaper) {
    exchangeFreeUsdt = await fetchExchangeFreeUsdtForBounce(exchangeFreeUsdt);
    const finalGate = evaluateBounceDispatchBalanceGate(exchangeFreeUsdt, prep.tradeUsd);
    if (!finalGate.success) {
      return { action: "skip" as const, detail: finalGate.skipDetail ?? "bounce_pre_dispatch_blocked" };
    }
    exchangeFreeUsdt = finalGate.exchangeFreeUsdt;
    bounceDispatchCleared = true;
  }

  let reservationId: string | null = null;
  let buyOrder: Record<string, unknown> | null = null;
  let buyLockHeld = false;
  const reserveResult = await acquireBuyCapitalReservation({
    supabase,
    userId,
    symbol,
    tradeUsd: prep.tradeUsd,
    currentBalance: oversoldBounceExecution && liveNotPaper ? exchangeFreeUsdt : currentBalance,
    effectiveConfidence: ctx.effectiveConfidence,
    rawWeighted: ctx.rawWeighted,
    bearish1hCap: ctx.bearish1hCap,
    aiConfidence: Number(ai.ai_confidence),
    cycleId,
    botId: prep.botId,
    ghostMode: ctx.ghostMode,
    isPaperOnly: ctx.isPaperOnly,
    usdtBalance: oversoldBounceExecution && liveNotPaper ? exchangeFreeUsdt : prep.usdtBalance,
    oversoldBounceMicroClip: oversoldBounceExecution && liveNotPaper,
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
      isTestMode: ctx.ghostMode ? true : (prep.exchangeSkipped || isPaperTradingEnvForced()),
      signal,
    }) as Record<string, unknown>;
    if ((buyOrder as any)?.critical_exchange_error) {
      return {
        action: "skip" as const,
        detail: `execute_buy_failed: ${String((buyOrder as any)?.error ?? "critical_exchange_error")}`,
      };
    }
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
    const stopLossPct = clamp(toNumber((row as any)?.stop_loss_pct, 2), 0.1, 50);
    const slPctFrac = resolveStopLossPctFraction(stopLossPct, symbol);
    const takeProfitPctRaw = clamp(toNumber((row as any)?.take_profit_pct, 4), 0.1, 100);
    const takeProfitPct = resolveTakeProfitPctPoints(takeProfitPctRaw, stopLossPct, symbol);
    const atrExitFill = computeAtrExitLevels(entryForDb, atr14, {
      stopLossPctFraction: slPctFrac,
      takeProfitPctFraction: takeProfitPct / 100,
    });
    let stopLossPersist = atrExitFill.stopLoss;
    if (!(stopLossPersist < entryForDb)) {
      stopLossPersist = Number((entryForDb * (1 - slPctFrac)).toFixed(8));
    }
    stopLossPersist = widenStopLossToDbFloor(entryForDb, stopLossPersist, slPctFrac);
    const takeProfitPersist = Number(
      Math.max(entryForDb + atrExitFill.tpDistance, atrExitFill.takeProfit).toFixed(8),
    );
    const slDistanceAtEntry = entryForDb - stopLossPersist;
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
      slDistance: slDistanceAtEntry,
      trailDistance: prep.trailDistance,
      atrExitAtFill: {
        atrPct: atrExitFill.atrPct,
        slAtrMult: atrExitFill.slAtrMult,
        tpAtrMult: atrExitFill.tpAtrMult,
        rewardRiskRatio: atrExitFill.rewardRiskRatio,
        basis: atrExitFill.basis,
      },
      effectiveConfidence: ctx.effectiveConfidence,
      rawWeighted: ctx.rawWeighted,
      bearish1hCap: ctx.bearish1hCap,
      aiReasoningJson,
      coinId: coinIdFromSymbol(symbol),
      technical,
      buyOrder: buyOrder as any,
      openedAt: prep.openedAt,
      feeUsdBuy,
      sizingMeta: {
        ...prep.sizingMeta,
        governance_execution_confidence: wr.executionConfidence,
        chart_execution_confidence: ctx.effectiveConfidence,
        governance_trade_usd: governanceTradeUsd,
      },
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
        trade_usd: Number(prep.tradeUsd.toFixed(8)),
        snapshot_price: Number(snapshotPrice.toFixed(8)),
        stage: "create_order_or_insert_trade",
      },
    });
    if (isTransientExchangeError(error) || detail.includes("exchange") || detail.includes("ccxt")) {
      await logCriticalExchangeError({
        label: "execute_buy_flow",
        detail,
        symbol,
        side: "buy",
        cycleId,
      });
    }
    return { action: "skip" as const, detail: `execute_buy_failed: ${detail}` };
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
