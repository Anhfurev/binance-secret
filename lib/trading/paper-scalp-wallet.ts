import type { DemoAccount } from "@/lib/types";

const DEFAULT_PAPER_WALLET_USD = 28;

export function resolvePaperScalpWalletUsd(): number {
  const raw = String(process.env.PAPER_SCALP_WALLET_USD ?? "").trim();
  const n = raw ? Number(raw) : DEFAULT_PAPER_WALLET_USD;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAPER_WALLET_USD;
  return n;
}

export function createFreshPaperScalpAccount(
  balance = resolvePaperScalpWalletUsd(),
): DemoAccount {
  const now = new Date();
  return {
    id: "paper-scalp",
    startingBalance: balance,
    currentBalance: balance,
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
    equityCurve: [{ time: now.toISOString(), equity: balance }],
    dailyPnl: 0,
    dailyPnlResetDate: now.toISOString().slice(0, 10),
    circuitBreakerTripped: false,
    openPositions: [],
    tradeHistory: [],
    createdAt: now,
    expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
    isActive: true,
  };
}

/**
 * Align cash to configured wallet without wiping trade history or DB baseline.
 */
export function alignPaperScalpWallet(
  account: DemoAccount,
  options?: { persistedStartingBalance?: number },
): DemoAccount {
  const target = resolvePaperScalpWalletUsd();
  const configuredBaseline = target;
  const persisted = options?.persistedStartingBalance;
  const baseline =
    persisted != null && persisted > 0 && persisted <= target * 2
      ? persisted
      : configuredBaseline;

  if (account.openPositions.length > 0) {
    return { ...account, startingBalance: baseline };
  }

  const hasHistory =
    account.tradeHistory.length > 0 || account.openPositions.length > 0;

  if (account.circuitBreakerTripped) {
    return {
      ...account,
      circuitBreakerTripped: false,
      currentBalance: hasHistory ? account.currentBalance : target,
      startingBalance: baseline,
    };
  }

  const staleMegaWallet =
    !hasHistory &&
    (account.currentBalance > target * 4 || account.startingBalance > target * 4);

  if (staleMegaWallet) {
    return {
      ...account,
      currentBalance: target,
      startingBalance: baseline,
    };
  }

  if (!hasHistory && Math.abs(account.currentBalance - target) > 0.01) {
    return {
      ...account,
      currentBalance: target,
      startingBalance: baseline,
    };
  }

  return { ...account, startingBalance: baseline };
}

export function paperWalletWasAligned(
  before: DemoAccount,
  after: DemoAccount,
): boolean {
  return (
    before.currentBalance !== after.currentBalance ||
    before.circuitBreakerTripped !== after.circuitBreakerTripped ||
    before.startingBalance !== after.startingBalance
  );
}
