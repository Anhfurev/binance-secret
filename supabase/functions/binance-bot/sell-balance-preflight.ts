// @ts-nocheck
/** Close DB open rows when Binance base is flat (manual sell / drift). */
import type { createClient } from "npm:@supabase/supabase-js@2";
import { baseAssetFromUsdtSymbol } from "./exchange-client.ts";
import { toNumber, toStringValue } from "./utils.ts";

const DUST_BASE = 1e-8;

export function isEffectivelyFlatExchangeBase(
  exchangeBaseFree: number,
  dbAmount: number,
): boolean {
  if (!Number.isFinite(exchangeBaseFree) || exchangeBaseFree < 0) return true;
  if (!Number.isFinite(dbAmount) || dbAmount <= 0) {
    return exchangeBaseFree <= DUST_BASE;
  }
  const threshold = Math.max(DUST_BASE, dbAmount * 1e-4);
  return exchangeBaseFree < threshold;
}

export async function reconcileFlatOpenTradeRow(params: {
  supabase: ReturnType<typeof createClient>;
  openId: string;
  openTrade: Record<string, unknown>;
  userId: string;
  symbol: string;
  cycleId?: string;
  reason: string;
  exchangeBaseObserved: number;
}): Promise<boolean> {
  const openId = toStringValue(params.openId);
  if (!openId) return false;
  const extra = (params.openTrade.extra as Record<string, unknown> | undefined) ?? {};
  const mergedExtra = {
    ...extra,
    reconciled_at: new Date().toISOString(),
    reconciliation_reason: params.reason,
    exchange_base_observed: params.exchangeBaseObserved,
    reconciliation_cycle_id: params.cycleId ?? null,
  };
  const { data, error } = await params.supabase
    .from("trades")
    .update({
      status: "RECONCILED_CLOSED",
      closed_at: new Date().toISOString(),
      exit_reason: "reconciled_exchange_flat",
      extra: mergedExtra,
      notes: `Reconciled: ${params.reason} (cycle=${params.cycleId ?? "n/a"})`,
    })
    .eq("id", openId)
    .ilike("status", "open")
    .select("id");
  if (error) {
    console.warn("[sell_reconcile] update failed", { openId, detail: error.message });
    return false;
  }
  return Array.isArray(data) && data.length === 1;
}

export function baseAssetFromSymbol(symbol: string): string {
  return baseAssetFromUsdtSymbol(symbol);
}

export function readSellDustBase(): number {
  const raw = Number(Deno.env.get("SELL_DUST_BASE") ?? "0.000001");
  return Number.isFinite(raw) && raw > 0 ? raw : 0.000001;
}

/** Minimum free base to attempt a live sell (below → reconcile flat). */
export function minSellableBaseThreshold(dbAmount: number): number {
  return Math.max(readSellDustBase(), dbAmount * 1e-4);
}
