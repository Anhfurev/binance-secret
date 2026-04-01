"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type {
  CoinData,
  GrowthCandidate,
  Alert,
  NewsItem,
  SentimentData,
  GlobalMarketData,
  AITradeSignal,
  PricePrediction,
  FuturesSignal,
  WhaleTransaction,
  DemoAccount,
  PortfolioSnapshot,
} from "@/lib/types";
import { mockDemoAccount } from "@/lib/demo-data";
import { mockPortfolio } from "@/lib/mock-data";

const fetcher = (url: string) => fetch(url).then((res) => res.json());
const DEMO_STORAGE_KEY = "nextrade-demo-account";

export interface PaperTradingSnapshot {
  currentBalance: number;
  totalPnl: number;
  totalPnlPercent: number;
  winRate: number;
  totalTrades: number;
  openPositions: number;
  closedTrades: number;
  dailyPnl: number;
  circuitBreakerTripped: boolean;
  bestTrade: number;
  worstTrade: number;
  source: "live" | "fallback";
  lastUpdated: Date | null;
}

const STABLE_ASSETS = new Set(["usdt", "usdc", "busd", "fdusd", "dai"]);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildPortfolioSnapshot(
  balances: Array<{ asset: string; free: number; locked: number }>,
  coins: CoinData[],
): PortfolioSnapshot {
  const assets = balances
    .map((balance) => {
      const symbol = balance.asset.toLowerCase();
      const amount = balance.free + balance.locked;
      const matchedCoin = coins.find((coin) => coin.symbol === symbol);
      const currentPrice = STABLE_ASSETS.has(symbol)
        ? 1
        : (matchedCoin?.current_price ?? 0);
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

  if (assets.length === 0) {
    return mockPortfolio;
  }

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
    Math.round(
      largestAllocation * 0.75 +
        diversificationPenalty -
        stableAllocation * 0.2,
    ),
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

function buildPaperTradingSnapshot(
  account: Partial<DemoAccount> | null,
): PaperTradingSnapshot {
  const base = account ?? mockDemoAccount;
  const history = Array.isArray(base.tradeHistory) ? base.tradeHistory : [];

  return {
    currentBalance: base.currentBalance ?? mockDemoAccount.currentBalance,
    totalPnl: base.totalPnl ?? mockDemoAccount.totalPnl,
    totalPnlPercent: base.totalPnlPercent ?? mockDemoAccount.totalPnlPercent,
    winRate: base.winRate ?? mockDemoAccount.winRate,
    totalTrades: base.totalTrades ?? history.length,
    openPositions: Array.isArray(base.openPositions)
      ? base.openPositions.length
      : 0,
    closedTrades: history.length,
    dailyPnl: base.dailyPnl ?? 0,
    circuitBreakerTripped: base.circuitBreakerTripped ?? false,
    bestTrade: base.bestTrade ?? mockDemoAccount.bestTrade,
    worstTrade: base.worstTrade ?? mockDemoAccount.worstTrade,
    source: account ? "live" : "fallback",
    lastUpdated: account ? new Date() : null,
  };
}

function readPaperTradingSnapshot(): PaperTradingSnapshot {
  if (typeof window === "undefined") {
    return buildPaperTradingSnapshot(null);
  }

  const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
  if (!raw) {
    return buildPaperTradingSnapshot(null);
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DemoAccount>;
    return buildPaperTradingSnapshot(parsed);
  } catch {
    return buildPaperTradingSnapshot(null);
  }
}

interface MarketResponse {
  coins: CoinData[];
  global: GlobalMarketData;
  source: "live" | "fallback";
  lastUpdated: string;
}

interface GrowthResponse {
  candidates: GrowthCandidate[];
  source: "live" | "fallback";
  lastUpdated: string;
  signalsChanged: boolean;
}

interface SentimentResponse {
  sentiment: SentimentData;
  news: NewsItem[];
  source: "live" | "fallback";
  lastUpdated: string;
}

interface AlertsResponse {
  alerts: Alert[];
  source: "live" | "fallback";
  lastUpdated: string;
}

interface WhaleResponse {
  transactions: (Omit<WhaleTransaction, "timestamp"> & {
    timestamp: string;
  })[];
  generatedAt: string;
}

export function useMarketData() {
  const { data, error, isLoading, mutate } = useSWR<MarketResponse>(
    "/api/market",
    fetcher,
    {
      refreshInterval: 60000, // Auto-refresh every 60 seconds
      revalidateOnFocus: false,
    },
  );

  return {
    coins: data?.coins ?? [],
    global: data?.global,
    source: data?.source ?? "fallback",
    lastUpdated: data?.lastUpdated ? new Date(data.lastUpdated) : null,
    isLoading,
    error,
    refresh: mutate,
  };
}

export function useGrowthCandidates() {
  const { data, error, isLoading, mutate } = useSWR<GrowthResponse>(
    "/api/growth",
    fetcher,
    {
      refreshInterval: 60000,
      revalidateOnFocus: false,
    },
  );

  return {
    candidates: data?.candidates ?? [],
    signalsChanged: data?.signalsChanged ?? false,
    source: data?.source ?? "fallback",
    lastUpdated: data?.lastUpdated ? new Date(data.lastUpdated) : null,
    isLoading,
    error,
    refresh: mutate,
  };
}

export function useSentimentData() {
  const { data, error, isLoading, mutate } = useSWR<SentimentResponse>(
    "/api/sentiment",
    fetcher,
    {
      refreshInterval: 300000, // Refresh every 5 minutes
      revalidateOnFocus: false,
    },
  );

  return {
    sentiment: data?.sentiment ?? {
      fearGreedIndex: 50,
      fearGreedLabel: "Neutral",
      socialSentiment: 50,
      socialSentimentLabel: "Neutral",
    },
    news: data?.news ?? [],
    source: data?.source ?? "fallback",
    lastUpdated: data?.lastUpdated ? new Date(data.lastUpdated) : null,
    isLoading,
    error,
    refresh: mutate,
  };
}

export function useAlerts() {
  const { data, error, isLoading, mutate } = useSWR<AlertsResponse>(
    "/api/alerts",
    fetcher,
    {
      refreshInterval: 30000, // Refresh every 30 seconds
      revalidateOnFocus: false,
    },
  );

  return {
    alerts: data?.alerts ?? [],
    source: data?.source ?? "fallback",
    lastUpdated: data?.lastUpdated ? new Date(data.lastUpdated) : null,
    isLoading,
    error,
    refresh: mutate,
  };
}

export function useWhaleActivity() {
  const { data, error, isLoading, mutate } = useSWR<WhaleResponse>(
    "/api/whale",
    fetcher,
    {
      refreshInterval: 60000,
      revalidateOnFocus: false,
    },
  );

  return {
    transactions: (data?.transactions ?? []).map((tx) => ({
      ...tx,
      timestamp: new Date(tx.timestamp),
    })),
    generatedAt: data?.generatedAt ? new Date(data.generatedAt) : null,
    isLoading,
    error,
    refresh: async () => {
      const next = await mutate();
      return (next?.transactions ?? []).map((tx) => ({
        ...tx,
        timestamp: new Date(tx.timestamp),
      }));
    },
  };
}

interface SignalsResponse {
  signals: AITradeSignal[];
  source: "live" | "fallback";
  lastUpdated: string;
  computed: boolean;
}

export function useSignalsData() {
  const { data, error, isLoading, mutate } = useSWR<SignalsResponse>(
    "/api/signals",
    fetcher,
    {
      refreshInterval: 120000, // 2 minutes
      revalidateOnFocus: false,
    },
  );

  return {
    signals: data?.signals ?? [],
    source: data?.source ?? "fallback",
    computed: data?.computed ?? false,
    lastUpdated: data?.lastUpdated ? new Date(data.lastUpdated) : null,
    isLoading,
    error,
    refresh: async () => {
      const next = await mutate();
      return next?.signals ?? [];
    },
  };
}

interface PredictionsResponse {
  predictions: PricePrediction[];
  source: "live" | "fallback";
  lastUpdated: string;
  computed: boolean;
}

export function usePredictionsData() {
  const { data, error, isLoading, mutate } = useSWR<PredictionsResponse>(
    "/api/predictions",
    fetcher,
    {
      refreshInterval: 300000, // 5 minutes
      revalidateOnFocus: false,
    },
  );

  return {
    predictions: data?.predictions ?? [],
    source: data?.source ?? "fallback",
    computed: data?.computed ?? false,
    lastUpdated: data?.lastUpdated ? new Date(data.lastUpdated) : null,
    isLoading,
    error,
    refresh: async () => {
      const next = await mutate();
      return next?.predictions ?? [];
    },
  };
}

export function usePaperTradingSnapshot() {
  const [snapshot, setSnapshot] = useState<PaperTradingSnapshot>(() =>
    buildPaperTradingSnapshot(null),
  );

  useEffect(() => {
    const loadSnapshot = () => {
      setSnapshot(readPaperTradingSnapshot());
    };

    loadSnapshot();
    window.addEventListener("storage", loadSnapshot);
    window.addEventListener("focus", loadSnapshot);

    return () => {
      window.removeEventListener("storage", loadSnapshot);
      window.removeEventListener("focus", loadSnapshot);
    };
  }, []);

  return {
    paperTrading: snapshot,
    refresh: () => {
      const next = readPaperTradingSnapshot();
      setSnapshot(next);
      return next;
    },
  };
}

export function usePortfolioSnapshot() {
  const { coins, refresh: refreshMarket } = useMarketData();
  const {
    configured,
    balances,
    refresh: refreshAccount,
  } = useBinanceAccountStatus();

  const portfolio = useMemo(() => {
    if (!configured || balances.length === 0) {
      return mockPortfolio;
    }

    return buildPortfolioSnapshot(balances, coins);
  }, [configured, balances, coins]);

  return {
    portfolio,
    source: configured && balances.length > 0 ? "live" : "fallback",
    refresh: async () => {
      const [nextMarket, nextAccount] = await Promise.all([
        refreshMarket(),
        refreshAccount(),
      ]);
      const nextCoins = nextMarket?.coins ?? coins;
      const nextConfigured = nextAccount?.configured ?? configured;
      const nextBalances = nextAccount?.nonZeroBalances ?? balances;

      if (!nextConfigured || nextBalances.length === 0) {
        return mockPortfolio;
      }

      return buildPortfolioSnapshot(nextBalances, nextCoins);
    },
  };
}

interface FuturesSignalsApiResponse {
  source: "live" | "fallback";
  generatedAt: string;
  signals: FuturesSignal[];
}

export function useFuturesSignals() {
  const { data, error, isLoading, mutate } = useSWR<FuturesSignalsApiResponse>(
    "/api/futures/signals",
    fetcher,
    {
      refreshInterval: 60000,
      revalidateOnFocus: false,
    },
  );

  return {
    signals: data?.signals ?? [],
    source: data?.source ?? "fallback",
    generatedAt: data?.generatedAt ? new Date(data.generatedAt) : null,
    isLoading,
    error,
    refresh: mutate,
  };
}

interface BinanceAccountStatusResponse {
  configured: boolean;
  canTrade?: boolean;
  canWithdraw?: boolean;
  canDeposit?: boolean;
  accountType?: string;
  permissions?: string[];
  nonZeroBalances?: Array<{
    asset: string;
    free: number;
    locked: number;
  }>;
  message?: string;
  error?: string;
}

export function useBinanceAccountStatus() {
  const { data, error, isLoading, mutate } =
    useSWR<BinanceAccountStatusResponse>("/api/binance/account", fetcher, {
      refreshInterval: 120000,
      revalidateOnFocus: false,
    });

  return {
    configured: data?.configured ?? false,
    canTrade: data?.canTrade ?? false,
    canWithdraw: data?.canWithdraw ?? false,
    permissions: data?.permissions ?? [],
    accountType: data?.accountType ?? "unknown",
    balances: data?.nonZeroBalances ?? [],
    message: data?.message,
    apiError: data?.error,
    isLoading,
    error,
    refresh: mutate,
  };
}
