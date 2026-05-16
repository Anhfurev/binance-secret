// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { adjustPaperDemoBalance, upsertBotPerformance } from "./trade-store.ts";
import { sendTelegramAlert } from "./notifier.ts";
import { escapeHtml, formatTelegramPrice, fromUsdCents, toUsdCents } from "./bot-shared.ts";
import { persistRunTelemetry } from "./bot-telemetry.ts";
import { botWarn } from "./bot-debug.ts";
import { toNumber } from "./utils.ts";
import { releaseTradeExecutionLock } from "./trade-execution-lock.ts";
import { shouldApplyPaperDemoLedgerDelta } from "./paper-balance.ts";

export function resolveOpenLegRemainingValue(
  remainingBase: number,
  markPrice: number,
): number {
  if (!(remainingBase > 0) || !(markPrice > 0)) return 0;
  return Number((remainingBase * markPrice).toFixed(8));
}

export async function handlePartialSellAndKeepOpen(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  openId: string;
  openTrade: Record<string, unknown>;
  amount: number;
  soldBase: number;
  entryPrice: number;
  exitPx: number;
  sellOrderId: string | null;
  sellOrder: Record<string, unknown>;
  isTestMode: boolean;
  ghostMode: boolean;
  shouldInitializeStartingBalance: boolean;
  resolvedStartingBalance: number;
  strategyNotes: string;
  technical: string;
  aiTrend: string;
  aiConfidence: number;
  effectiveExitReason?: string;
  partialExitReason?: string;
  partialFill?: boolean;
  currentBalance: number;
  pnl: number;
  pnlPercent: number;
  nextBalance?: number;
  feeUsdSell?: number;
  /** When set, lock is released only after the open-row partial update succeeds. */
  botId?: string | null;
  cycleId?: string | null;
}) {
  const {
    supabase,
    userId,
    symbol,
    openId,
    openTrade,
    amount,
    soldBase,
    entryPrice,
    exitPx,
    sellOrderId,
    sellOrder,
    isTestMode,
    ghostMode,
    shouldInitializeStartingBalance,
    resolvedStartingBalance,
    strategyNotes,
    technical,
    aiTrend,
    aiConfidence,
    effectiveExitReason,
    partialExitReason,
    partialFill: forcedPartialFill,
    currentBalance,
    pnl,
    pnlPercent,
    botId,
    cycleId,
    nextBalance: resolvedNextBalance,
    feeUsdSell,
  } = params;
  const remainingBase = Number(Math.max(amount - soldBase, 0).toFixed(8));
  const remainingValue = resolveOpenLegRemainingValue(remainingBase, exitPx);
  const closedAt = new Date().toISOString();
  const exitNotional = soldBase * exitPx;
  const sellFeeUsd = toNumber(feeUsdSell, 0);
  const nextBalance = typeof resolvedNextBalance === "number" && Number.isFinite(resolvedNextBalance)
    ? resolvedNextBalance
    : shouldApplyPaperDemoLedgerDelta(isTestMode, ghostMode)
      ? await adjustPaperDemoBalance(supabase, userId, exitNotional - sellFeeUsd)
      : fromUsdCents(
        toUsdCents(currentBalance) + toUsdCents(exitNotional) - toUsdCents(sellFeeUsd),
      );
  const currentExtra = ((openTrade as any)?.extra as Record<string, unknown> | undefined) ?? {};
  const realizedPnlBefore = toNumber(currentExtra.realized_pnl_usd, 0);
  const realizedPnlNow = fromUsdCents(toUsdCents(realizedPnlBefore) + toUsdCents(pnl));
  const partialReason = partialExitReason ?? effectiveExitReason ?? "partial_tp";

  const partialResult = await supabase.from("trades").update({
    status: "open",
    amount: remainingBase,
    value: remainingValue,
    exchange_order_id: sellOrderId,
    extra: {
      ...currentExtra,
      is_paper: isTestMode && !ghostMode,
      is_ghost: ghostMode,
      trade_mode: ghostMode ? "ghost" : isTestMode ? "paper" : "live",
      execution_type: (sellOrder as any)?.execution_type ?? null,
      actual_slippage_pct: (sellOrder as any)?.actual_slippage_pct ?? null,
      smart_execution_meta: (sellOrder as any)?.smart_execution_meta ?? null,
      partial_sell: true,
      partial_tp_executed: true,
      partial_exit_reason: partialReason,
      partial_tp_exit_reason: partialReason,
      partial_sell_at: closedAt,
      partial_sold_base: soldBase,
      partial_remaining_base: remainingBase,
      partial_realized_pnl_usd: pnl,
      realized_pnl_usd: realizedPnlNow,
      fee_usd_sell: sellFeeUsd > 0 ? Number(sellFeeUsd.toFixed(8)) : 0,
      partial_sell_fee_usd: sellFeeUsd > 0 ? Number(sellFeeUsd.toFixed(8)) : 0,
    },
    notes:
      `Partial SELL ${soldBase} (remaining ${remainingBase}) | strategy=${strategyNotes} | tech=${technical} ai=${aiTrend}(${aiConfidence})`,
  })
    .eq("id", openId)
    .ilike("status", "open")
    .select("id");
  if (partialResult.error) {
    throw new Error(`Failed to persist partial SELL state (${openId}): ${partialResult.error.message}`);
  }
  const partialRows = Array.isArray(partialResult.data) ? partialResult.data : [];
  if (partialRows.length !== 1) {
    throw new Error(
      `sellFlow: partial update expected exactly 1 open row for ${openId}, got ${partialRows.length}`,
    );
  }
  if (botId && cycleId) {
    await releaseTradeExecutionLock({
      supabase,
      botId: String(botId),
      cycleId: String(cycleId),
      side: "sell",
    });
  }
  if (!ghostMode) {
    await upsertBotPerformance(supabase, { userId, symbol, pnl });
  }
  await persistRunTelemetry({
    supabase,
    userId,
    symbol,
    action: "sell",
    detail: `PARTIAL SELL ${soldBase} @ ${exitPx.toFixed(8)} | pnl ${pnl.toFixed(2)} | remain ${remainingBase}`,
    balance: nextBalance,
  });
  await sendTelegramAlert(
    `🟠 <b>PARTIAL SELL</b>\n` +
      `<b>Symbol:</b> ${escapeHtml(symbol)}\n` +
      `<b>Price:</b> ${formatTelegramPrice(exitPx)}\n` +
      `<b>Sold:</b> ${soldBase}\n` +
      `<b>Remaining:</b> ${remainingBase}\n` +
      `<b>Realized PnL:</b> ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT (${pnlPercent.toFixed(2)}%)\n` +
      `<b>Balance After:</b> ${nextBalance.toFixed(2)} USDT\n` +
      `<b>Strategy:</b> ${escapeHtml(strategyNotes)}`,
  );
  botWarn("sellFlow", "partial_sell_open_position_retained", {
    userId,
    symbol,
    openAmount: amount,
    soldBase,
    remainingBase,
    pnl,
    nextBalance,
  });
  return {
    action: "sell" as const,
    detail:
      `PARTIAL SELL ${soldBase} @ ${exitPx.toFixed(8)} | remain ${remainingBase} | pnl ${pnl.toFixed(2)} | balance ${nextBalance.toFixed(2)}`,
    nextBalance,
  };
}
