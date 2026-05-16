// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { extractLegFeeUsd } from "./fill-fees.ts";

export async function insertSellFillQualityLog(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  amount: number;
  soldBase: number;
  snapshotPrice: number;
  exitPx: number;
  sellOrder: Record<string, unknown>;
  ghostMode: boolean;
  isTestMode: boolean;
  partialFill: boolean;
}) {
  const {
    supabase,
    userId,
    symbol,
    amount,
    soldBase,
    snapshotPrice,
    exitPx,
    sellOrder,
    ghostMode,
    isTestMode,
    partialFill,
  } = params;
  await supabase.from("logs").insert([{
    user_id: userId,
    symbol,
    level: "info",
    source: "execution-quality",
    message: "sell_fill_quality",
    meta: {
      event: "sell_fill_quality",
      requested_qty: Number(amount.toFixed(8)),
      filled_qty: Number(soldBase.toFixed(8)),
      fill_ratio: amount > 0 ? Number((soldBase / amount).toFixed(6)) : null,
      signal_price: Number(snapshotPrice.toFixed(8)),
      exit_price_effective: Number(exitPx.toFixed(8)),
      execution_type: (sellOrder as any)?.execution_type ?? null,
      slippage_pct: (sellOrder as any)?.actual_slippage_pct ?? null,
      fee_usd: extractLegFeeUsd(sellOrder) || null,
      trade_mode: ghostMode ? "ghost" : isTestMode ? "paper" : "live",
      partial_fill: partialFill,
    },
    created_at: new Date().toISOString(),
  }]);
}
