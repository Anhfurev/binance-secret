// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { AiAnalysis, BotSettingsRow, MarketRegime, OpenTradeRow } from "./types.ts";
import { resolveSpotRoundTripTakerFeePct } from "./constants.ts";
import { createOrder } from "./binance.ts";
import { formatAmount, normalizePriceForSymbol } from "./exchange-client.ts";
import { resolveExchangeSkipped, resolveGhostMode, resolveTestMode } from "./bot-shared.ts";
import { resolveSellFillFinancials } from "./sell-financials.ts";
import { handlePartialSellAndKeepOpen } from "./sell-partial.ts";
import { loadOpenTrade } from "./trade-store.ts";
import { botDebug, botWarn } from "./bot-debug.ts";
import { toNumber, toStringValue } from "./utils.ts";

export const DEFAULT_PARTIAL_TP_FRACTION = 0.5;

export function readPartialTakeProfitFraction(): number {
  const raw = String(Deno.env.get("PARTIAL_TP_FRACTION") ?? "").trim();
  const n = raw.length ? Number(raw) : DEFAULT_PARTIAL_TP_FRACTION;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PARTIAL_TP_FRACTION;
  return Math.min(0.9, Math.max(0.1, n));
}

export function resolveOneToOneTakeProfitPrice(
  entryPrice: number,
  stopLossPrice: number,
): number | null {
  const entry = toNumber(entryPrice, 0);
  const stop = toNumber(stopLossPrice, 0);
  if (!(entry > 0) || !(stop > 0) || !(stop < entry)) return null;
  return Number((entry + (entry - stop)).toFixed(8));
}

export function shouldTriggerPartialTakeProfit(
  openTrade: OpenTradeRow,
  currentPrice: number,
): boolean {
  const extra = (openTrade.extra as Record<string, unknown> | undefined) ?? {};
  if (extra.partial_tp_executed === true) return false;
  const entry = toNumber(openTrade.entryPrice, 0);
  const stop = toNumber(openTrade.stopLoss, 0);
  const trigger = resolveOneToOneTakeProfitPrice(entry, stop);
  if (trigger == null || !(currentPrice > 0)) return false;
  return currentPrice >= trigger;
}

export async function armBreakEvenAfterPartialTakeProfit(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  openTrade: OpenTradeRow;
}) {
  const { supabase, userId, symbol, openTrade } = params;
  const openId = toStringValue(openTrade.id);
  if (!openId) return { armed: false };
  const entry = toNumber(openTrade.entryPrice, 0);
  if (!(entry > 0)) return { armed: false };
  const feeFrac = resolveSpotRoundTripTakerFeePct();
  const stopLossTick = await normalizePriceForSymbol(symbol, entry * (1 + feeFrac));
  const nowIso = new Date().toISOString();
  const currentExtra = (openTrade.extra as Record<string, unknown> | undefined) ?? {};
  const updateResult = await supabase
    .from("trades")
    .update({
      stopLoss: stopLossTick,
      extra: {
        ...currentExtra,
        break_even_after_partial_tp: true,
        break_even_armed_at: nowIso,
        break_even_stop_price: stopLossTick,
        break_even_fee_buffer_pct: Number((feeFrac * 100).toFixed(6)),
      },
    })
    .eq("id", openId)
    .ilike("status", "open")
    .select("id");
  if (updateResult.error) {
    throw new Error(`Failed to arm break-even after partial TP (${openId}): ${updateResult.error.message}`);
  }
  const rows = Array.isArray(updateResult.data) ? updateResult.data : [];
  if (rows.length !== 1) {
    throw new Error(`break_even_after_ptp expected 1 row for ${openId}, got ${rows.length}`);
  }
  botDebug("sellFlow", "break_even_after_partial_tp", {
    userId,
    symbol,
    openId,
    stopLoss: stopLossTick,
  });
  return { armed: true, stopLoss: stopLossTick };
}

export async function tryPartialTakeProfitIfDue(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  userId: string;
  symbol: string;
  openTrade: OpenTradeRow;
  currentPrice: number;
  technical: string;
  ai: AiAnalysis;
  strategyNotes: string;
  currentBalance: number;
  resolvedStartingBalance: number;
  shouldInitializeStartingBalance: boolean;
  cycleId: string;
  marketRegime: MarketRegime;
  signal?: AbortSignal;
}) {
  const {
    supabase, row, userId, symbol, openTrade, currentPrice, technical, ai,
    strategyNotes, currentBalance, resolvedStartingBalance, shouldInitializeStartingBalance,
    cycleId, marketRegime, signal,
  } = params;
  if (!shouldTriggerPartialTakeProfit(openTrade, currentPrice)) {
    return { executed: false as const };
  }

  const openId = toStringValue(openTrade.id);
  const entryPrice = toNumber(openTrade.entryPrice, currentPrice);
  const amount = toNumber(openTrade.amount, 0);
  if (!openId || !(amount > 0) || !(entryPrice > 0)) {
    return { executed: false as const };
  }

  const botId = toStringValue((row as any).id);
  const isTestMode = resolveTestMode(row);
  const ghostMode = resolveGhostMode(row);
  const exchangeSkipped = resolveExchangeSkipped(row);
  const sellFraction = readPartialTakeProfitFraction();
  const rawSellBase = amount * sellFraction;
  const sellBase = Number((await formatAmount(symbol, rawSellBase)).toString());
  if (!(sellBase > 0)) {
    botWarn("sellFlow", "partial_tp_zero_qty", { userId, symbol, openId, amount, sellFraction });
    return { executed: false as const };
  }

  if (ghostMode && !exchangeSkipped) {
    throw new Error("Invariant: ghostMode requires resolveExchangeSkipped for partial TP");
  }

  const sellOrder = await createOrder({
    supabase,
    userId,
    botId: botId ?? undefined,
    cycleId,
    symbol,
    side: "sell",
    amount: sellBase,
    referencePrice: currentPrice,
    marketRegime,
    isTestMode: ghostMode ? true : exchangeSkipped,
    signal,
    executionMode: "market",
  });
  if ((sellOrder as any)?.idempotent) {
    return { executed: false as const };
  }

  const fillPx = toNumber((sellOrder as any)?.average ?? (sellOrder as any)?.price, currentPrice);
  const exitPx = Number.isFinite(fillPx) && fillPx > 0 ? fillPx : currentPrice;
  const {
    soldBase,
    partialFill,
    pnl,
    pnlPercent,
    nextBalance,
  } = await resolveSellFillFinancials({
    supabase,
    userId,
    symbol,
    amount,
    entryPrice,
    exitPx,
    sellOrder: sellOrder as Record<string, unknown>,
    isTestMode,
    ghostMode,
    currentBalance,
    resolvedStartingBalance,
    openTradeExtra: (openTrade.extra as Record<string, unknown> | undefined) ?? null,
  });
  if (!(soldBase > 0)) return { executed: false as const };

  const partialResult = await handlePartialSellAndKeepOpen({
    supabase,
    userId,
    symbol,
    openId,
    openTrade: openTrade as Record<string, unknown>,
    amount,
    soldBase,
    entryPrice,
    exitPx,
    sellOrderId: toStringValue((sellOrder as any)?.exchange_order_id),
    sellOrder: sellOrder as Record<string, unknown>,
    isTestMode,
    ghostMode,
    shouldInitializeStartingBalance,
    resolvedStartingBalance,
    strategyNotes,
    technical,
    aiTrend: ai.trend,
    aiConfidence: ai.ai_confidence,
    effectiveExitReason: "partial_tp",
    currentBalance,
    pnl,
    pnlPercent,
    botId,
    cycleId,
    partialExitReason: "partial_tp",
    partialFill: partialFill || soldBase < amount * 0.999,
    nextBalance,
    feeUsdSell,
  });

  const reloaded = await loadOpenTrade(supabase, userId, symbol, botId ?? undefined);
  if (reloaded) {
    await armBreakEvenAfterPartialTakeProfit({ supabase, userId, symbol, openTrade: reloaded });
  }

  return {
    executed: true as const,
    detail: partialResult.detail,
    nextBalance: partialResult.nextBalance ?? nextBalance,
    reloadTrade: reloaded,
  };
}
