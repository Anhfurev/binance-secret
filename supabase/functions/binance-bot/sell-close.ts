// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { sendTradeRowNotification } from "./notifier.ts";

export async function closeTradeRowAfterSell(params: {
  supabase: ReturnType<typeof createClient>;
  openId: string;
  openTrade: Record<string, unknown>;
  userId: string;
  symbol: string;
  isTestMode: boolean;
  ghostMode: boolean;
  sellOrder: Record<string, unknown>;
  strategyNotes: string;
  technical: string;
  aiTrend: string;
  aiConfidence: number;
  pnl: number;
  pnlPercent: number;
  closedAt: string;
  sellOrderId: string | null;
  exitPx: number;
  entryPrice: number;
  soldValueUsd: number;
  effectiveExitReason?: string;
  /** When true, caller sends one consolidated Telegram (avoids duplicate with bot-sell). */
  skipTradeRowTelegram?: boolean;
}) {
  const {
    supabase,
    openId,
    openTrade,
    userId,
    symbol,
    isTestMode,
    ghostMode,
    sellOrder,
    strategyNotes,
    technical,
    aiTrend,
    aiConfidence,
    pnl,
    pnlPercent,
    closedAt,
    sellOrderId,
    exitPx,
    entryPrice,
    soldValueUsd,
    effectiveExitReason,
    skipTradeRowTelegram,
  } = params;
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
    notes: `Closed by Edge SELL | strategy=${strategyNotes} | tech=${technical} ai=${aiTrend}(${aiConfidence})`,
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
  if (!skipTradeRowTelegram) {
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
}
