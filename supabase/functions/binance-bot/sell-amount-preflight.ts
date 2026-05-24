// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import {
  getAvailableBalance,
  getSharedBinanceSignedExchange,
  toCcxtSymbol,
} from "./exchange-client.ts";
import {
  isEffectivelyFlatExchangeBase,
  minSellableBaseThreshold,
  reconcileFlatOpenTradeRow,
} from "./sell-balance-preflight.ts";
import { toNumber } from "./utils.ts";

export type SellAmountPreflightResult =
  | { ok: true; amount: number; clamped: boolean; freeBase: number }
  | { ok: false; action: "reconciled" | "skip"; detail: string; freeBase: number };

/** Align sell qty with free Binance base — avoids InsufficientFunds spam. */
export async function prepareLiveSellAmount(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  openId: string;
  openTrade: Record<string, unknown>;
  requestedAmount: number;
  cycleId?: string;
  exchangeSkipped: boolean;
  isTestMode: boolean;
}): Promise<SellAmountPreflightResult> {
  const {
    supabase,
    userId,
    symbol,
    openId,
    openTrade,
    requestedAmount,
    cycleId,
    exchangeSkipped,
    isTestMode,
  } = params;

  if (exchangeSkipped || isTestMode) {
    return {
      ok: true,
      amount: requestedAmount,
      clamped: false,
      freeBase: requestedAmount,
    };
  }

  let freeBase = 0;
  try {
    freeBase = await getAvailableBalance(symbol);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.warn("[sell_preflight] balance_fetch_failed", { symbol, userId, detail });
    return {
      ok: false,
      action: "skip",
      detail: `sell_preflight_balance_fetch_failed:${detail.slice(0, 120)}`,
      freeBase: 0,
    };
  }

  const threshold = minSellableBaseThreshold(requestedAmount);
  if (isEffectivelyFlatExchangeBase(freeBase, requestedAmount)) {
    const reconciled = await reconcileFlatOpenTradeRow({
      supabase,
      openId,
      openTrade,
      userId,
      symbol,
      cycleId,
      reason: "sell_preflight_exchange_flat",
      exchangeBaseObserved: freeBase,
    });
    console.log("[sell_preflight] exchange_flat_reconcile", {
      symbol,
      userId,
      openId,
      free_base: freeBase,
      db_amount: requestedAmount,
      reconciled: reconciled ? 1 : 0,
    });
    return {
      ok: false,
      action: reconciled ? "reconciled" : "skip",
      detail: reconciled
        ? "SELL skipped: exchange flat — DB row RECONCILED_CLOSED"
        : "SELL skipped: exchange flat — reconcile update failed",
      freeBase,
    };
  }

  if (freeBase + 1e-12 >= requestedAmount) {
    return { ok: true, amount: requestedAmount, clamped: false, freeBase };
  }

  let clamped = freeBase * 0.998;
  try {
    const exchange = getSharedBinanceSignedExchange();
    await exchange.loadMarkets();
    const ccxtSymbol = toCcxtSymbol(symbol);
    clamped = Number(exchange.amountToPrecision(ccxtSymbol, clamped));
  } catch {
    clamped = Number(clamped.toFixed(8));
  }

  if (!(clamped >= threshold)) {
    const reconciled = await reconcileFlatOpenTradeRow({
      supabase,
      openId,
      openTrade,
      userId,
      symbol,
      cycleId,
      reason: "sell_preflight_clamp_below_dust",
      exchangeBaseObserved: freeBase,
    });
    return {
      ok: false,
      action: reconciled ? "reconciled" : "skip",
      detail: "SELL skipped: free base below sellable dust after clamp",
      freeBase,
    };
  }

  console.log("[sell_preflight] amount_clamped", {
    symbol,
    userId,
    requested: requestedAmount,
    free_base: freeBase,
    sell_amount: clamped,
  });
  return { ok: true, amount: clamped, clamped: true, freeBase };
}
