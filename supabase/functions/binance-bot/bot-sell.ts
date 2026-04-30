// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { AiAnalysis, BotSettingsRow, ExitReason, MarketRegime, OpenTradeRow, SignalDecision } from "./types.ts";
import { coinIdFromSymbol, toNumber, toStringValue } from "./utils.ts";
import { normalizePriceForSymbol } from "./exchange-client.ts";
import { createOrder } from "./binance.ts";
import { insertTrade, updateProfileBalance, upsertBotPerformance } from "./trade-store.ts";
import {
  sendTelegramAlert,
  sendTradeRowNotification,
  sendTrailingStopAlert,
} from "./notifier.ts";
import {
  escapeHtml,
  formatTelegramPrice,
  fromUsdCents,
  resolveExchangeSkipped,
  resolveGhostMode,
  resolveTestMode,
  toUsdCents,
} from "./bot-shared.ts";
import { persistRunTelemetry } from "./bot-telemetry.ts";
import { botDebug, botError, botWarn } from "./bot-debug.ts";

const BREAK_EVEN_TRIGGER_PCT = 1.5;

export async function applyBreakEvenTrigger(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  openTrade: OpenTradeRow;
  currentPrice: number;
}) {
  const { supabase, userId, symbol, openTrade, currentPrice } = params;
  const openId = toStringValue(openTrade.id);
  if (!openId) return { triggered: false, pnlPercent: 0 };

  const entryPrice = toNumber(openTrade.entryPrice, 0);
  const amount = toNumber(openTrade.amount, 0);
  const initialValue = toNumber(
    openTrade.value,
    amount > 0 && entryPrice > 0 ? amount * entryPrice : 0,
  );
  if (entryPrice <= 0 || amount <= 0 || initialValue < 0.01) {
    return { triggered: false, pnlPercent: 0 };
  }

  const pnl = (currentPrice - entryPrice) * amount;
  const pnlPercentRaw = (pnl / initialValue) * 100;
  const pnlPercent = Number.isFinite(pnlPercentRaw)
    ? Number(pnlPercentRaw.toFixed(2))
    : 0;
  if (pnlPercent < BREAK_EVEN_TRIGGER_PCT) {
    return { triggered: false, pnlPercent };
  }

  const currentStopLoss = toNumber((openTrade as any)?.stopLoss, 0);
  const epsilon = 0.00000001;
  if (currentStopLoss >= entryPrice - epsilon) {
    return { triggered: false, pnlPercent };
  }

  const nowIso = new Date().toISOString();
  const currentExtra = ((openTrade.extra as Record<string, unknown> | undefined) ?? {});
  const stopLossTick = await normalizePriceForSymbol(symbol, entryPrice);
  const updateResult = await supabase
    .from("trades")
    .update({
      stopLoss: stopLossTick,
      extra: {
        ...currentExtra,
        break_even_triggered: true,
        break_even_triggered_at: nowIso,
        break_even_trigger_pnl_pct: pnlPercent,
      },
    })
    .eq("id", openId)
    .select("id");

  if (updateResult.error) {
    throw new Error(
      `Failed to arm break-even stopLoss (${openId}): ${updateResult.error.message}`,
    );
  }
  const beRows = Array.isArray(updateResult.data) ? updateResult.data : [];
  if (beRows.length !== 1) {
    throw new Error(
      `break_even update expected exactly 1 row for ${openId}, got ${beRows.length}`,
    );
  }
  await sendTradeRowNotification({
    event: "update",
    trade: {
      id: openId,
      user_id: userId,
      symbol,
      type: toStringValue(openTrade.type) ?? "buy",
      status: toStringValue(openTrade.status) ?? "open",
      entryPrice,
      value: initialValue,
      notes: "Break-even stopLoss armed",
      exit_reason: "break_even_stoploss_armed",
    },
    reason: `UPDATED: break-even armed at +${pnlPercent.toFixed(2)}%`,
  });

  await supabase.from("logs").insert([{
    user_id: userId,
    symbol,
    level: "info",
    source: "safety",
    message: "break_even_stoploss_armed",
    meta: {
      event: "break_even_stoploss_armed",
      open_trade_id: openId,
      trigger_pnl_percent: pnlPercent,
      stop_loss_set_to: stopLossTick,
      market_price: Number(currentPrice.toFixed(8)),
    },
    created_at: nowIso,
  }]);

  botDebug("sellFlow", "break_even_armed", {
    userId,
    symbol,
    openId,
    triggerPnlPercent: pnlPercent,
    stopLoss: stopLossTick,
  });
  return { triggered: true, pnlPercent };
}

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
}) {
  const {
    supabase, row, userId, symbol, openTrade, snapshotPrice, technical, ai,
    effectiveDecision, effectiveExitReason, strategyNotes, currentBalance,
    resolvedStartingBalance, shouldInitializeStartingBalance, trailingStopTriggered,
    cycleId,
    marketRegime,
  } = params;
  const openId = toStringValue(openTrade.id);
  const entryPrice = toNumber(openTrade.entryPrice, snapshotPrice);
  const amount = toNumber(openTrade.amount, 0);
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
  const createOrderTestShortCircuit = ghostMode ? true : exchangeSkipped;

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
    maxSlippagePct: 0.2,
    isTestMode: createOrderTestShortCircuit,
  });
  if ((sellOrder as any)?.idempotent) {
    botWarn("sellFlow", "idempotent_duplicate_block", { userId, symbol, botId, cycleId });
    return {
      action: "skip" as const,
      detail: `Duplicate SELL skipped (cycle) for bot=${botId ?? "n/a"} cycle=${cycleId}`,
    };
  }
  const sellOrderId = toStringValue((sellOrder as any)?.exchange_order_id);
  if (!exchangeSkipped) {
    const fillPx = Number((sellOrder as any)?.average ?? (sellOrder as any)?.price);
    if (Number.isFinite(fillPx) && fillPx > 0) {
      exitPx = Number(fillPx.toFixed(8));
    }
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

  const soldBase = toNumber((sellOrder as any)?.amount, amount);
  if (!Number.isFinite(soldBase) || soldBase <= 0) {
    throw new Error(`sellFlow: invalid filled base qty after SELL for ${symbol}`);
  }
  if (soldBase < amount * 0.999) {
    botWarn("sellFlow", "partial_sell_vs_open_row", {
      userId,
      symbol,
      openAmount: amount,
      soldBase,
    });
  }

  const exitNotional = soldBase * exitPx;
  const entryCost = soldBase * entryPrice;
  const pnl = fromUsdCents(toUsdCents(exitNotional) - toUsdCents(entryCost));
  const notionalForPct = soldBase * entryPrice;
  const pnlPercentRaw = Number.isFinite(notionalForPct) && notionalForPct >= 0.01
    ? (pnl / notionalForPct) * 100
    : 0;
  const pnlPercent = Number.isFinite(pnlPercentRaw)
    ? Number(pnlPercentRaw.toFixed(2))
    : 0;
  const nextBalance = ghostMode
    ? currentBalance
    : fromUsdCents(toUsdCents(currentBalance) + toUsdCents(exitNotional));
  const accountPnl = fromUsdCents(toUsdCents(nextBalance) - toUsdCents(resolvedStartingBalance));
  const soldValueUsd = Number((soldBase * entryPrice).toFixed(2));

  {
    const closeResult = await supabase.from("trades").update({
      status: pnl >= 0 ? "closed" : "stopped",
      exitPrice: Number(exitPx.toFixed(8)),
      pnl,
      pnlPercent,
      closed_at: closedAt,
      exchange_order_id: sellOrderId,
      exit_reason: effectiveExitReason ?? "signal_exit",
      extra: {
        ...(((openTrade as any)?.extra as Record<string, unknown> | undefined) ?? {}),
        is_paper: isTestMode && !ghostMode,
        is_ghost: ghostMode,
        trade_mode: ghostMode ? "ghost" : isTestMode ? "paper" : "live",
        execution_type: (sellOrder as any)?.execution_type ?? null,
        actual_slippage_pct: (sellOrder as any)?.actual_slippage_pct ?? null,
        smart_execution_meta: (sellOrder as any)?.smart_execution_meta ?? null,
      },
      notes: `Closed by Edge SELL | strategy=${strategyNotes} | tech=${technical} ai=${ai.trend}(${ai.ai_confidence})`,
    })
      .eq("id", openId)
      .ilike("status", "open")
      .select("id");
    if (closeResult.error) {
      throw new Error(`Failed to close open trade (${openId}): ${closeResult.error.message}`);
    }
    const updatedRows = Array.isArray(closeResult.data) ? closeResult.data : [];
    if (updatedRows.length !== 1) {
      throw new Error(
        `sellFlow: close update expected exactly 1 row for open trade ${openId}, got ${updatedRows.length} — aborting SELL ledger insert (zombie risk: exchange may be flat while DB still open)`,
      );
    }
    await sendTradeRowNotification({
      event: "update",
      trade: {
        id: openId,
        user_id: userId,
        symbol,
        type: "sell",
        status: pnl >= 0 ? "closed" : "stopped",
        entryPrice,
        exitPrice: exitPx,
        pnl,
        value: soldValueUsd,
        exit_reason: effectiveExitReason ?? "signal_exit",
        notes: `Closed by Edge SELL | strategy=${strategyNotes}`,
      },
      reason: `SOLD: ${effectiveExitReason ?? "signal_exit"}`,
    });
  }

  await insertTrade(supabase, {
    user_id: userId,
    signalId: `edge-sell-${Date.now()}`,
    exchange_order_id: sellOrderId,
    coinId: coinIdFromSymbol(symbol),
    symbol,
    type: "sell",
    entryPrice: Number(entryPrice.toFixed(8)),
    exitPrice: Number(exitPx.toFixed(8)),
    amount: soldBase,
    value: soldValueUsd,
    status: pnl >= 0 ? "closed" : "stopped",
    pnl,
    pnlPercent,
    opened_at: toStringValue(openTrade.opened_at) ?? closedAt,
    closed_at: closedAt,
    exit_reason: effectiveExitReason ?? "signal_exit",
    extra: {
      bot_id: botId ?? null,
      cycle_id: cycleId,
      is_paper: isTestMode && !ghostMode,
      is_ghost: ghostMode,
      trade_mode: ghostMode ? "ghost" : isTestMode ? "paper" : "live",
      execution_type: (sellOrder as any)?.execution_type ?? null,
      actual_slippage_pct: (sellOrder as any)?.actual_slippage_pct ?? null,
      smart_execution_meta: (sellOrder as any)?.smart_execution_meta ?? null,
    },
    followedSignal: true,
    notes: `Edge SELL | strategy=${strategyNotes} | tech=${technical} ai=${ai.trend}(${ai.ai_confidence})`,
  }, `SOLD: ${effectiveExitReason ?? "signal_exit"} | ${strategyNotes}`);
  if (!ghostMode) {
    await updateProfileBalance(
      supabase,
      userId,
      nextBalance,
      shouldInitializeStartingBalance ? resolvedStartingBalance : undefined,
    );
    await upsertBotPerformance(supabase, { userId, symbol, pnl });
  }
  await persistRunTelemetry({
    supabase,
    userId,
    symbol,
    action: "sell",
    detail: `SELL ${soldBase} @ ${exitPx.toFixed(8)} | pnl ${pnl.toFixed(2)}`,
    balance: nextBalance,
  });
  if (trailingStopTriggered) {
    await sendTrailingStopAlert({ symbol, pnlPercent });
  }
  await sendTelegramAlert(
    (ghostMode ? `👻 <b>GHOST SELL</b> (DB only, no Binance)\n` : `🔴 <b>SELL ORDER</b>\n`) +
      `<b>Symbol:</b> ${escapeHtml(symbol)}\n` +
      `<b>Price:</b> ${formatTelegramPrice(exitPx)}\n` +
      `<b>Trade PnL:</b> ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT (${pnlPercent.toFixed(2)}%)\n` +
      `<b>Balance After:</b> ${nextBalance.toFixed(2)} USDT\n` +
      `<b>Total PnL:</b> ${accountPnl >= 0 ? "+" : ""}${accountPnl.toFixed(2)} USDT\n` +
      `<b>Strategy:</b> ${escapeHtml(strategyNotes)}`,
  );
  botDebug("sellFlow", "sell_completed", {
    userId,
    symbol,
    amount: soldBase,
    pnl,
    pnlPercent,
    nextBalance,
    orderId: sellOrderId ?? "n/a",
  });
  return {
    action: "sell" as const,
    detail: `SELL ${soldBase} @ ${exitPx.toFixed(8)} | pnl ${pnl.toFixed(2)} | balance ${nextBalance.toFixed(2)}`,
    nextBalance,
  };
}
