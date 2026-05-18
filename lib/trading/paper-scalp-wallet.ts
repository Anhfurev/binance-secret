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

/** Rebase stale demo megawallets to the configured paper wallet (default $28). */
export function alignPaperScalpWallet(account: DemoAccount): DemoAccount {
  const target = resolvePaperScalpWalletUsd();

  if (account.openPositions.length > 0) {
    return account;
  }

  const balanceDrift = Math.abs(account.currentBalance - target);
  const startDrift = Math.abs(account.startingBalance - target);
  const staleMegaWallet =
    account.currentBalance > target * 2 || account.startingBalance > target * 2;

  const needsReset =
    balanceDrift > 0.01 ||
    startDrift > 0.01 ||
    account.circuitBreakerTripped ||
    staleMegaWallet ||
    account.tradeHistory.length > 50;

  if (!needsReset) {
    return account;
  }

  return createFreshPaperScalpAccount(target);
}

export function paperWalletWasAligned(
  before: DemoAccount,
  after: DemoAccount,
): boolean {
  return (
    before.currentBalance !== after.currentBalance ||
    before.circuitBreakerTripped !== after.circuitBreakerTripped ||
    before.tradeHistory.length !== after.tradeHistory.length ||
    before.openPositions.length !== after.openPositions.length
  );
}
