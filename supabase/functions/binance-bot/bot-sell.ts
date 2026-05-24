// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { AiAnalysis, BotSettingsRow, ExitReason, MarketRegime, OpenTradeRow, SignalDecision } from "./types.ts";
import { toNumber, toStringValue } from "./utils.ts";
import { normalizePriceForSymbol } from "./exchange-client.ts";
import { createOrder } from "./binance.ts";
import { handlePartialSellAndKeepOpen } from "./sell-partial.ts";
import { closeTradeRowAfterSell } from "./sell-close.ts";
import { resolveExchangeSkipped, resolveGhostMode, resolveTestMode } from "./bot-shared.ts";
import { isPaperTradingEnvForced } from "./paper-trade-interceptor.ts";
import { resolveSellFillFinancials } from "./sell-financials.ts";
import { resolveFillVwap } from "./fill-fees.ts";
import { insertSellFillQualityLog } from "./sell-fill-quality.ts";
import { notifyFullSellClose } from "./sell-notify-full-close.ts";
import { botDebug, botError, botWarn } from "./bot-debug.ts";
import { releaseTradeExecutionLock } from "./trade-execution-lock.ts";
import { prepareLiveSellAmount } from "./sell-amount-preflight.ts";
import { resolveOpenTradeEntryPrice } from "./trade-row-helpers.ts";
export { applyBreakEvenTrigger } from "./sell-break-even.ts";

export async function executeSellFlow(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  userId: string;
  symbol: string;
  openTrade: OpenTradeRow;
  snapshotPrice: number;
  technical: SignalDecision;
  ai: AiAnalysis;
  effectiveDecision: SignalDecision;
  effectiveExitReason?: ExitReason;
  strategyNotes: string;
  currentBalance: number;
  resolvedStartingBalance: number;
  shouldInitializeStartingBalance: boolean;
  trailingStopTriggered: boolean;
  cycleId: string;
  marketRegime: MarketRegime;
  signal?: AbortSignal;
}) {
  const {
    supabase, row, userId, symbol, openTrade, snapshotPrice, technical, ai,
    effectiveDecision, effectiveExitReason, strategyNotes, currentBalance,
    resolvedStartingBalance, shouldInitializeStartingBalance, trailingStopTriggered,
    cycleId,
    marketRegime,
    signal,
  } = params;
  const openId = toStringValue(openTrade.id);
  const entryPrice = resolveOpenTradeEntryPrice(openTrade, snapshotPrice);
  let amount = toNumber(openTrade.amount, 0);
  const initialValue = toNumber(openTrade.value, amount > 0 ? amount * entryPrice : 0);
  if (amount <= 0 || initialValue <= 0) {
    botWarn("sellFlow", "invalid_open_trade_block", { userId, symbol, amount, initialValue });
    return { action: "skip" as const, detail: "Open position is invalid for SELL" };
  }

  if (!openId) {
    botWarn("sellFlow", "missing_open_trade_id", { userId, symbol });
    return { action: "skip" as const, detail: "SELL aborted: missing open trade id" };
  }

  const closedAt = new Date().toISOString();
  const botId = toStringValue((row as any).id);
  const isTestMode = resolveTestMode(row);
  const ghostMode = resolveGhostMode(row);
  const exchangeSkipped = resolveExchangeSkipped(row);
  const useLiveStyleMark = !isTestMode || ghostMode;
  let exitPx = useLiveStyleMark
    ? await normalizePriceForSymbol(symbol, snapshotPrice)
    : Number(snapshotPrice.toFixed(8));

  const { data: openRowSanity, error: openSanityErr } = await supabase
    .from("trades")
    .select("id")
    .eq("id", openId)
    .ilike("status", "open")
    .maybeSingle();
  if (openSanityErr) {
    throw new Error(
      `sellFlow: open-trade sanity query failed for ${openId}: ${openSanityErr.message}`,
    );
  }
  if (!openRowSanity?.id) {
    botWarn("sellFlow", "open_trade_not_open_abort", { userId, symbol, openId });
    return {
      action: "skip" as const,
      detail: "SELL aborted: position is no longer open (ghost / parallel close)",
    };
  }

  const createOrderTestShortCircuit = ghostMode
    ? true
    : (exchangeSkipped || isPaperTradingEnvForced());

  const sellPrep = await prepareLiveSellAmount({
    supabase,
    userId,
    symbol,
    openId,
    openTrade: openTrade as Record<string, unknown>,
    requestedAmount: amount,
    cycleId,
    exchangeSkipped,
    isTestMode: createOrderTestShortCircuit,
  });
  if (!sellPrep.ok) {
    botWarn("sellFlow", "sell_preflight_block", {
      userId,
      symbol,
      openId,
      action: sellPrep.action,
      free_base: sellPrep.freeBase,
      detail: sellPrep.detail,
    });
    return { action: "skip" as const, detail: sellPrep.detail };
  }
  amount = sellPrep.amount;
  if (sellPrep.clamped) {
    botDebug("sellFlow", "sell_amount_clamped", {
      userId,
      symbol,
      amount: Number(amount.toFixed(8)),
      free_base: sellPrep.freeBase,
    });
  }

  botDebug("sellFlow", "pre_create_sell_order", {
    userId,
    symbol,
    amount: Number(amount.toFixed(8)),
    ghostMode,
    exchangeSkipped,
    cycleId,
    botId: botId || null,
    openId,
    marketRegime,
  });
  // Hard wall: ghost execution must never call CCXT with isTestMode: false.
  if (ghostMode && !exchangeSkipped) {
    botError("sellFlow", "ghost_live_create_order_invariant_broken", {
      userId,
      symbol,
      ghostMode,
      exchangeSkipped,
      openId,
    });
    throw new Error(
      "Invariant: ghostMode requires resolveExchangeSkipped — refusing createOrder (SELL) to protect live funds",
    );
  }

  const sellOrder = await createOrder({
    supabase,
    userId,
    botId: botId ?? undefined,
    cycleId,
    symbol,
    side: "sell",
    amount,
    referencePrice: snapshotPrice,
    marketRegime,
    isTestMode: createOrderTestShortCircuit,
    signal,
  });
  if ((sellOrder as any)?.idempotent) {
    botWarn("sellFlow", "idempotent_duplicate_block", { userId, symbol, botId, cycleId });
    return {
      action: "skip" as const,
      detail: `Duplicate SELL skipped (cycle) for bot=${botId ?? "n/a"} cycle=${cycleId}`,
    };
  }
  const sellOrderId = toStringValue((sellOrder as any)?.exchange_order_id);
  // Live (CCXT) and paper (`simulatePaperFill`) return the same `average`/`price`
  // shape — read both so paper PnL includes the same fee/slippage haircut as live.
  const fillPx = resolveFillVwap(sellOrder as Record<string, unknown>, snapshotPrice);
  if (Number.isFinite(fillPx) && fillPx > 0) {
    exitPx = fillPx;
  }

  const bridgeResult = await supabase
    .from("trades")
    .update({ exchange_order_id: sellOrderId })
    .eq("id", openId)
    .ilike("status", "open")
    .select("id");
  if (bridgeResult.error) {
    throw new Error(
      `sellFlow: failed to persist exchange_order_id on open row (${openId}): ${bridgeResult.error.message}`,
    );
  }
  const bridgeRows = Array.isArray(bridgeResult.data) ? bridgeResult.data : [];
  if (bridgeRows.length !== 1) {
    throw new Error(
      `sellFlow: exchange_order_id bridge expected exactly 1 row for open trade ${openId}, got ${bridgeRows.length} — aborting (possible ghost trade or race)`,
    );
  }

  const {
    soldBase,
    partialFill,
    pnl,
    pnlPercent,
    nextBalance,
    accountPnl,
    soldValueUsd,
    feeUsdBuy,
    feeUsdSell,
  } = await resolveSellFillFinancials({
    supabase,
    userId,
    symbol,
    amount,
    entryPrice,
    exitPx,
    sellOrder: sellOrder as any,
    isTestMode,
    ghostMode,
    currentBalance,
    resolvedStartingBalance,
    openTradeExtra: ((openTrade as any)?.extra as Record<string, unknown> | undefined) ?? null,
  });

  await insertSellFillQualityLog({
    supabase,
    userId,
    symbol,
    amount,
    soldBase,
    snapshotPrice,
    exitPx,
    sellOrder: sellOrder as any,
    ghostMode,
    isTestMode,
    partialFill,
  });

  if (partialFill) {
    const partialResult = await handlePartialSellAndKeepOpen({
      supabase,
      userId,
      symbol,
      openId,
      openTrade: openTrade as any,
      amount,
      soldBase,
      entryPrice,
      exitPx,
      sellOrderId,
      sellOrder: sellOrder as any,
      isTestMode,
      ghostMode,
      shouldInitializeStartingBalance,
      resolvedStartingBalance,
      strategyNotes,
      technical,
      aiTrend: ai.trend,
      aiConfidence: ai.ai_confidence,
      effectiveExitReason,
      currentBalance,
      pnl,
      pnlPercent,
      botId,
      cycleId,
      nextBalance,
      feeUsdSell,
    });
    return partialResult;
  }

  await closeTradeRowAfterSell({
    supabase,
    openId,
    openTrade: openTrade as any,
    userId,
    symbol,
    isTestMode,
    ghostMode,
    sellOrder: sellOrder as any,
    strategyNotes,
    technical,
    aiTrend: ai.trend,
    aiConfidence: ai.ai_confidence,
    pnl,
    pnlPercent,
    closedAt,
    sellOrderId,
    exitPx,
    entryPrice,
    soldValueUsd,
    effectiveExitReason,
    skipTradeRowTelegram: true,
    feeUsdBuy,
    feeUsdSell,
  });

  if (botId && cycleId) {
    await releaseTradeExecutionLock({ supabase, botId, cycleId, side: "sell" });
  }

  // NOTE: We deliberately DO NOT insert a separate `type='sell'` ledger row.
  // The buy row was already UPDATEd above with `status`, `exitPrice`, `pnl`,
  // `pnlPercent`, `closed_at`, `exit_reason`, and the extra payload — that is
  // the canonical record of the closed position. Inserting a paired sell row
  // double-counted PnL and inflated win/loss/turnover metrics 2x.
  await notifyFullSellClose({
    supabase,
    userId,
    symbol,
    strategyNotes,
    ghostMode,
    pnl,
    pnlPercent,
    nextBalance,
    accountPnl,
    exitPx,
    soldBase,
    trailingStopTriggered,
    sellOrderId,
  });
  return {
    action: "sell" as const,
    detail: `SELL ${soldBase} @ ${exitPx.toFixed(8)} | pnl ${pnl.toFixed(2)} | balance ${nextBalance.toFixed(2)}`,
    nextBalance,
  };
}
