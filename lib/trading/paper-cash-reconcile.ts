import { stripInvalidOpenLegs } from "@/lib/trading/paper-nav-sanitize";
import { resolvePaperScalpWalletUsd } from "@/lib/trading/paper-scalp-wallet";
import type { DemoAccount, DemoTrade } from "@/lib/types";

function normSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

function legEntryNotional(leg: DemoTrade): number {
  if (leg.value > 0) return leg.value;
  return leg.amount * leg.entryPrice;
}

/** One open leg per symbol — prevents duplicate DOGE/ETH rows inflating NAV. */
export function dedupeOpenPositionsBySymbol(account: DemoAccount): DemoAccount {
  const bySymbol = new Map<string, DemoTrade>();
  for (const leg of account.openPositions) {
    const key = normSymbol(leg.symbol);
    const prev = bySymbol.get(key);
    if (!prev) {
      bySymbol.set(key, leg);
      continue;
    }
    const prevLayer = prev.pyramidLayers ?? 0;
    const nextLayer = leg.pyramidLayers ?? 0;
    if (nextLayer > prevLayer || leg.openedAt.getTime() > prev.openedAt.getTime()) {
      bySymbol.set(key, leg);
    }
  }
  return { ...account, openPositions: [...bySymbol.values()] };
}

/**
 * Free cash = starting wallet − capital deployed at entry.
 * Fixes NAV double-count when profile.available_usdt ($28) is merged while legs stay open.
 */
export function reconcilePaperAccountCash(account: DemoAccount): DemoAccount {
  const starting =
    account.startingBalance > 0
      ? account.startingBalance
      : resolvePaperScalpWalletUsd();
  const deployed = account.openPositions.reduce(
    (sum, leg) => sum + legEntryNotional(leg),
    0,
  );
  const freeCash = Number(Math.max(0, starting - deployed).toFixed(4));
  return {
    ...account,
    startingBalance: starting,
    currentBalance: freeCash,
  };
}

export function normalizePaperWorkspaceAccount(account: DemoAccount): DemoAccount {
  return reconcilePaperAccountCash(
    dedupeOpenPositionsBySymbol(stripInvalidOpenLegs(account)),
  );
}
