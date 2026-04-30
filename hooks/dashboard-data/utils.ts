import type { CoinData, DemoAccount, PortfolioSnapshot } from "@/lib/types";
import { mockDemoAccount } from "@/lib/demo-data";
import { mockPortfolio } from "@/lib/mock-data";
import type { PaperTradingSnapshot, PartialDemoAccount } from "@/hooks/dashboard-data/types";
import { DEMO_STORAGE_KEY } from "@/hooks/dashboard-data/types";

const STABLE_ASSETS = new Set(["usdt", "usdc", "busd", "fdusd", "dai"]);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function buildPortfolioSnapshot(
  balances: Array<{ asset: string; free: number; locked: number }>,
  coins: CoinData[],
): PortfolioSnapshot {
  const assets = balances
    .map((balance) => {
      const symbol = balance.asset.toLowerCase();
      const amount = balance.free + balance.locked;
      const matchedCoin = coins.find((coin) => coin.symbol === symbol);
      const currentPrice = STABLE_ASSETS.has(symbol) ? 1 : (matchedCoin?.current_price ?? 0);
      const value = amount * currentPrice;
      const dailyChange = matchedCoin?.price_change_percentage_24h ?? 0;
      const previousPrice =
        currentPrice > 0 && Math.abs(100 + dailyChange) > Number.EPSILON
          ? currentPrice / (1 + dailyChange / 100)
          : currentPrice;
      const pnl24h = amount * (currentPrice - previousPrice);

      return {
        coinId: matchedCoin?.id ?? symbol,
        symbol: balance.asset.toUpperCase(),
        name: matchedCoin?.name ?? balance.asset.toUpperCase(),
        amount,
        value,
        allocation: 0,
        pnl24h,
        pnlPercent24h: dailyChange,
      };
    })
    .filter((asset) => asset.amount > 0 && asset.value > 0)
    .sort((left, right) => right.value - left.value);

  if (assets.length === 0) return mockPortfolio;

  const totalBalance = assets.reduce((sum, asset) => sum + asset.value, 0);
  const pnl24h = assets.reduce((sum, asset) => sum + asset.pnl24h, 0);
  const normalizedAssets = assets.map((asset) => ({
    ...asset,
    allocation: totalBalance > 0 ? (asset.value / totalBalance) * 100 : 0,
  }));
  const largestAllocation = normalizedAssets[0]?.allocation ?? 0;
  const stableAllocation = normalizedAssets
    .filter((asset) => STABLE_ASSETS.has(asset.symbol.toLowerCase()))
    .reduce((sum, asset) => sum + asset.allocation, 0);
  const diversificationPenalty = Math.max(0, 24 - normalizedAssets.length * 4);
  const riskScore = clamp(
    Math.round(largestAllocation * 0.75 + diversificationPenalty - stableAllocation * 0.2),
    12,
    96,
  );

  return {
    totalBalance,
    pnl24h,
    pnlPercent24h: totalBalance > 0 ? (pnl24h / totalBalance) * 100 : 0,
    assets: normalizedAssets,
    riskScore,
    capitalProtectionMode: mockPortfolio.capitalProtectionMode,
  };
}

export function buildPaperTradingSnapshot(account: PartialDemoAccount): PaperTradingSnapshot {
  const base = account ?? mockDemoAccount;
  const history = Array.isArray(base.tradeHistory) ? base.tradeHistory : [];

  return {
    currentBalance: base.currentBalance ?? mockDemoAccount.currentBalance,
    totalPnl: base.totalPnl ?? mockDemoAccount.totalPnl,
    totalPnlPercent: base.totalPnlPercent ?? mockDemoAccount.totalPnlPercent,
    winRate: base.winRate ?? mockDemoAccount.winRate,
    totalTrades: base.totalTrades ?? history.length,
    openPositions: Array.isArray(base.openPositions) ? base.openPositions.length : 0,
    closedTrades: history.length,
    dailyPnl: base.dailyPnl ?? 0,
    circuitBreakerTripped: base.circuitBreakerTripped ?? false,
    bestTrade: base.bestTrade ?? mockDemoAccount.bestTrade,
    worstTrade: base.worstTrade ?? mockDemoAccount.worstTrade,
    source: account ? "live" : "fallback",
    lastUpdated: account ? new Date() : null,
  };
}

export function readPaperTradingSnapshot() {
  if (typeof window === "undefined") return buildPaperTradingSnapshot(null);
  const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
  if (!raw) return buildPaperTradingSnapshot(null);
  try {
    return buildPaperTradingSnapshot(JSON.parse(raw) as Partial<DemoAccount>);
  } catch {
    return buildPaperTradingSnapshot(null);
  }
}
