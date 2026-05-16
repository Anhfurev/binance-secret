// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { OpenTradeRow } from "./types.ts";
import { toNumber, toStringValue } from "./utils.ts";
import { normalizePriceForSymbol } from "./exchange-client.ts";
import { sendTradeRowNotification } from "./notifier.ts";
import { botDebug } from "./bot-debug.ts";

const BREAK_EVEN_TRIGGER_PCT = 1.5;

export function readClassicBreakEvenEnabled(): boolean {
  const raw = String(Deno.env.get("CLASSIC_BREAK_EVEN_ENABLED") ?? "0").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function shouldArmClassicBreakEven(openTrade: OpenTradeRow): boolean {
  if (!readClassicBreakEvenEnabled()) return false;
  const extra = (openTrade.extra as Record<string, unknown> | undefined) ?? {};
  if (extra.break_even_triggered === true) return false;
  if (extra.break_even_after_partial_tp === true) return false;
  if (extra.partial_tp_executed === true) return false;
  return true;
}

export async function maybeArmClassicBreakEven(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  openTrade: OpenTradeRow;
  currentPrice: number;
}) {
  if (!shouldArmClassicBreakEven(params.openTrade)) {
    return { triggered: false as const, pnlPercent: 0 };
  }
  return applyBreakEvenTrigger(params);
}

/**
 * Arm a break-even stop on a profitable open position. Once unrealized PnL
 * crosses `BREAK_EVEN_TRIGGER_PCT`, raise `stopLoss` to entry (tick-aligned)
 * so the worst-case outcome on this trade is a flat exit.
 */
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
    .ilike("status", "open")
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
