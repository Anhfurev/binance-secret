// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { simulatePaperFill } from "./paper-fill.ts";
import { fetchPublicSpotTicker } from "./public-ticker.ts";
import { logTradeAction } from "./trading-logger.ts";
import { releaseTradeExecutionLock } from "./trade-execution-lock.ts";
import { execObserve } from "./exec-observe.ts";

export async function runPaperCreateOrder(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  side: string;
  amount: number;
  marketRegime: string;
  signalPx: number;
  signal?: AbortSignal;
  botId?: string;
  cycleId?: string;
  sideType: string;
}): Promise<Record<string, unknown>> {
  const {
    supabase,
    userId,
    symbol,
    side,
    amount,
    marketRegime,
    signalPx,
    signal,
    botId,
    cycleId,
    sideType,
  } = params;

  if (!Number.isFinite(signalPx) || signalPx <= 0) {
    if (botId && cycleId) {
      await releaseTradeExecutionLock({
        supabase,
        botId: String(botId),
        cycleId: String(cycleId),
        side: sideType as "buy" | "sell",
      });
    }
    throw new Error(
      `createOrder(test): referencePrice required for paper ${side} (${symbol})`,
    );
  }

  try {
    const book = await fetchPublicSpotTicker(symbol, signal);
    if (book == null) {
      execObserve("public_ticker_null", {
        symbol,
        side,
        aborted: Boolean(signal?.aborted),
      });
    }
    const order = await simulatePaperFill({
      symbol,
      side: side as "buy" | "sell",
      amount,
      signalPrice: signalPx,
      marketRegime: String(marketRegime ?? "NEUTRAL"),
      tickerBid: book?.bid,
      tickerAsk: book?.ask,
      tickerLast: book?.last,
    });
    await logTradeAction({
      supabase,
      action: "PAPER ORDER (simulated)",
      level: "info",
      userId,
      symbol,
      source: "paper",
      data: {
        side,
        amount: order.amount,
        signal_price: signalPx,
        fill_price: order.price,
        effective_price: order.average,
        slippage_pct: order.actual_slippage_pct,
        fee_usd: order.smart_execution_meta?.fee_usd,
        regime: order.smart_execution_meta?.regime,
      },
    });
    return {
      exchange_order_id: order.exchange_order_id,
      symbol,
      side,
      type: order.type,
      amount: order.amount,
      status: order.status,
      price: order.price,
      average: order.average,
      execution_type: order.execution_type,
      actual_slippage_pct: order.actual_slippage_pct,
      smart_execution_meta: order.smart_execution_meta,
      idempotent: false,
      testMode: true,
    };
  } catch (e) {
    if (botId && cycleId) {
      await releaseTradeExecutionLock({
        supabase,
        botId: String(botId),
        cycleId: String(cycleId),
        side: sideType as "buy" | "sell",
      });
    }
    throw e;
  }
}
