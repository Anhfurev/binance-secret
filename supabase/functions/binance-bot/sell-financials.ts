// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { adjustPaperDemoBalance } from "./trade-store.ts";
import { fromUsdCents, toUsdCents } from "./bot-shared.ts";
import { toNumber } from "./utils.ts";
import { botWarn } from "./bot-debug.ts";
import { execObserve } from "./exec-observe.ts";

export function isPartialSellFill(openAmount: number, soldBase: number): boolean {
  return soldBase < openAmount * 0.999;
}

export async function resolveSellFillFinancials(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  amount: number;
  entryPrice: number;
  exitPx: number;
  sellOrder: Record<string, unknown>;
  isTestMode: boolean;
  ghostMode: boolean;
  currentBalance: number;
  resolvedStartingBalance: number;
}) {
  const {
    supabase,
    userId,
    symbol,
    amount,
    entryPrice,
    exitPx,
    sellOrder,
    isTestMode,
    ghostMode,
    currentBalance,
    resolvedStartingBalance,
  } = params;
  const soldBase = toNumber((sellOrder as any)?.amount, amount);
  if (!Number.isFinite(soldBase) || soldBase <= 0) {
    throw new Error(`sellFlow: invalid filled base qty after SELL for ${symbol}`);
  }
  const partialFill = isPartialSellFill(amount, soldBase);
  const fillRatio = amount > 0 ? soldBase / amount : 1;
  if (fillRatio < 0.999 || fillRatio > 1.001) {
    execObserve("sell_fill_qty_mismatch", {
      symbol,
      requested_qty: Number(amount.toFixed(8)),
      filled_qty: Number(soldBase.toFixed(8)),
      fill_ratio: Number(fillRatio.toFixed(6)),
    });
  }
  if (partialFill) {
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
  let nextBalance = fromUsdCents(
    toUsdCents(currentBalance) + toUsdCents(exitNotional),
  );
  if (isTestMode || ghostMode) {
    nextBalance = await adjustPaperDemoBalance(supabase, userId, exitNotional);
  }
  const accountPnl = fromUsdCents(toUsdCents(nextBalance) - toUsdCents(resolvedStartingBalance));
  const soldValueUsd = Number((soldBase * entryPrice).toFixed(2));
  return {
    soldBase,
    partialFill,
    pnl,
    pnlPercent,
    nextBalance,
    accountPnl,
    soldValueUsd,
  };
}
