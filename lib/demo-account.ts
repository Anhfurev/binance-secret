import { fetchAccountBalanceHistory, insertAccountBalance } from "@/lib/supabase";
import type { DemoAccount, DemoTrade } from "@/lib/types";

function hydrateTradeDates(
  trade: DemoTrade & { openedAt: string | Date; closedAt?: string | Date },
): DemoTrade {
  return {
    ...trade,
    openedAt:
      trade.openedAt instanceof Date
        ? trade.openedAt
        : new Date(trade.openedAt),
    closedAt:
      trade.closedAt instanceof Date
        ? trade.closedAt
        : trade.closedAt
          ? new Date(trade.closedAt)
          : undefined,
  };
}

// This function is now deprecated. Use fetchAccountBalanceHistory instead.
export function createEmptyDeprecatedDemoAccount() {
  return {
    id: "",
    startingBalance: 0,
    currentBalance: 0,
    totalPnl: 0,
    totalPnlPercent: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    bestTrade: 0,
    worstTrade: 0,
    currentDrawdown: 0,
    maxDrawdown: 0,
    equityCurve: [],
    dailyPnl: 0,
    dailyPnlResetDate: "",
    circuitBreakerTripped: false,
    openPositions: [],
    tradeHistory: [],
    createdAt: new Date(),
    expiresAt: new Date(),
    isActive: true,
  };
}
// Fetch account balance history from Supabase
export async function getAccountBalanceHistory(user_id: string) {
  const history = await fetchAccountBalanceHistory(user_id);
  return history.map((item) => ({
    ...item,
    timestamp: new Date(item.timestamp),
  }));
}

// Insert a new account balance snapshot to Supabase
export async function saveAccountBalance(user_id: string, balance: number, extra = {}) {
  await insertAccountBalance({
    user_id,
    balance,
    timestamp: new Date().toISOString(),
    extra,
  });
}

export function serializeAccount(account: DemoAccount) {
  return JSON.stringify({
    ...account,
    createdAt: account.createdAt.toISOString(),
    expiresAt: account.expiresAt.toISOString(),
    openPositions: account.openPositions.map((trade) => ({
      ...trade,
      openedAt:
        trade.openedAt instanceof Date
          ? trade.openedAt.toISOString()
          : trade.openedAt,
      closedAt:
        trade.closedAt instanceof Date
          ? trade.closedAt.toISOString()
          : trade.closedAt,
    })),
    tradeHistory: account.tradeHistory.map((trade) => ({
      ...trade,
      openedAt:
        trade.openedAt instanceof Date
          ? trade.openedAt.toISOString()
          : trade.openedAt,
      closedAt:
        trade.closedAt instanceof Date
          ? trade.closedAt.toISOString()
          : trade.closedAt,
    })),
  });
}

export function hydrateAccount(raw: string): DemoAccount | null {
  try {
    const parsed = JSON.parse(raw) as DemoAccount & {
      createdAt: string;
      expiresAt: string;
      openPositions: Array<DemoTrade & { openedAt: string; closedAt?: string }>;
      tradeHistory: Array<DemoTrade & { openedAt: string; closedAt?: string }>;
    };

    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      expiresAt: new Date(parsed.expiresAt),
      openPositions: (parsed.openPositions ?? []).map(hydrateTradeDates),
      tradeHistory: (parsed.tradeHistory ?? []).map(hydrateTradeDates),
    };
  } catch {
    return null;
  }
}

export function percentOf(value: number, base: number) {
  if (base <= 0) return 0;
  return (value / base) * 100;
}

export function recalculateAccountMetrics(account: DemoAccount): DemoAccount {
  const closedTrades = account.tradeHistory.filter(
    (trade) => typeof trade.pnl === "number",
  );
  const winning = closedTrades.filter((trade) => (trade.pnl ?? 0) > 0);
  const losing = closedTrades.filter((trade) => (trade.pnl ?? 0) < 0);
  const totalPnl = closedTrades.reduce(
    (sum, trade) => sum + (trade.pnl ?? 0),
    0,
  );

  const avgWin =
    winning.length > 0
      ? winning.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0) /
        winning.length
      : 0;
  const avgLoss =
    losing.length > 0
      ? Math.abs(
          losing.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0) /
            losing.length,
        )
      : 0;

  const bestTrade =
    closedTrades.length > 0
      ? Math.max(...closedTrades.map((trade) => trade.pnl ?? 0))
      : 0;
  const worstTrade =
    closedTrades.length > 0
      ? Math.min(...closedTrades.map((trade) => trade.pnl ?? 0))
      : 0;

  return {
    ...account,
    totalTrades: closedTrades.length,
    winningTrades: winning.length,
    losingTrades: losing.length,
    winRate:
      closedTrades.length > 0
        ? (winning.length / closedTrades.length) * 100
        : 0,
    totalPnl,
    totalPnlPercent: percentOf(totalPnl, account.startingBalance),
    avgWin,
    avgLoss,
    bestTrade,
    worstTrade,
  };
}

export function normalizeAccount(account: DemoAccount): DemoAccount {
  const normalized = recalculateAccountMetrics(account);

  return {
    ...normalized,
    currentBalance:
      typeof account.currentBalance === "number" &&
      Number.isFinite(account.currentBalance)
        ? account.currentBalance
        : account.startingBalance + normalized.totalPnl,
    currentDrawdown:
      typeof account.currentDrawdown === "number" &&
      Number.isFinite(account.currentDrawdown)
        ? account.currentDrawdown
        : 0,
    maxDrawdown:
      typeof account.maxDrawdown === "number" &&
      Number.isFinite(account.maxDrawdown)
        ? account.maxDrawdown
        : 0,
    equityCurve: Array.isArray(account.equityCurve) ? account.equityCurve : [],
  };
}
