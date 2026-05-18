// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { toNumber } from "./utils.ts";

export type TokenHoldingSnapshot = {
  free: number;
  locked: number;
};

export type PortfolioHoldingsSnapshot = Record<string, TokenHoldingSnapshot>;

export function buildHoldingsFromOpenTrades(params: {
  availableUsdt: number;
  openTrades: Array<{
    symbol?: string;
    amount?: number;
    value?: number;
    entryPrice?: number;
    price?: number;
  }>;
}): PortfolioHoldingsSnapshot {
  const holdings: PortfolioHoldingsSnapshot = {
    USDT: {
      free: Math.max(0, toNumber(params.availableUsdt, 0)),
      locked: 0,
    },
  };
  for (const trade of params.openTrades) {
    const symbol = String(trade.symbol ?? "").toUpperCase();
    const base = symbol.replace(/USDT$/, "");
    if (!base) continue;
    const amount = toNumber(trade.amount, 0);
    if (!(amount > 0)) continue;
    const prev = holdings[base] ?? { free: 0, locked: 0 };
    holdings[base] = {
      free: Number((prev.free + amount).toFixed(12)),
      locked: prev.locked,
    };
  }
  return holdings;
}

export function estimateNavUsdFromHoldings(
  holdings: PortfolioHoldingsSnapshot,
  priceByBase: Record<string, number>,
): number {
  let total = toNumber(holdings.USDT?.free, 0) + toNumber(holdings.USDT?.locked, 0);
  for (const [base, row] of Object.entries(holdings)) {
    if (base === "USDT") continue;
    const qty = toNumber(row?.free, 0) + toNumber(row?.locked, 0);
    const px = toNumber(priceByBase[base], 0);
    if (qty > 0 && px > 0) total += qty * px;
  }
  return Number(total.toFixed(2));
}

export async function syncProfilePortfolioHoldings(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  availableUsdt: number;
  priceByBase?: Record<string, number>;
}): Promise<{ holdings: PortfolioHoldingsSnapshot; navUsd: number } | null> {
  const { supabase, userId, availableUsdt, priceByBase = {} } = params;
  const { data, error } = await supabase
    .from("trades")
    .select("symbol,amount,value,entryPrice,price")
    .eq("user_id", userId)
    .ilike("status", "open");
  if (error) {
    console.warn(`[portfolio-holdings] open trades load failed: ${error.message}`);
    return null;
  }
  const holdings = buildHoldingsFromOpenTrades({
    availableUsdt,
    openTrades: (data ?? []) as Array<Record<string, unknown>>,
  });
  const navUsd = estimateNavUsdFromHoldings(holdings, priceByBase);
  const patch = {
    portfolio_holdings: holdings,
    available_usdt: Number(Math.max(0, availableUsdt).toFixed(2)),
    portfolio_nav_usdt: navUsd,
    updated_at: new Date().toISOString(),
  };
  const upd = await supabase.from("profiles").update(patch).eq("id", userId);
  if (upd.error) {
    console.warn(`[portfolio-holdings] profile update failed: ${upd.error.message}`);
    return null;
  }
  return { holdings, navUsd };
}
