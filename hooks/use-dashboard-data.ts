"use client";

import { useEffect, useMemo, useState } from "react";
import { mockPortfolio } from "@/lib/mock-data";
import { buildPaperTradingSnapshot, buildPortfolioSnapshot, readPaperTradingSnapshot } from "@/hooks/dashboard-data/utils";
import { PAPER_TRADING_UPDATED_EVENT, type PaperTradingSnapshot } from "@/hooks/dashboard-data/types";
import {
  useAlerts,
  useBinanceAccountStatus,
  useFuturesSignals,
  useGrowthCandidates,
  useMarketData,
  usePredictionsData,
  useSentimentData,
  useSignalsData,
  useWhaleActivity,
} from "@/hooks/dashboard-data/swr-hooks";

export {
  useMarketData,
  useGrowthCandidates,
  useSentimentData,
  useAlerts,
  useWhaleActivity,
  useSignalsData,
  usePredictionsData,
  useFuturesSignals,
  useBinanceAccountStatus,
};

export type { PaperTradingSnapshot } from "@/hooks/dashboard-data/types";

export function usePaperTradingSnapshot() {
  const [snapshot, setSnapshot] = useState<PaperTradingSnapshot>(() => buildPaperTradingSnapshot(null));

  useEffect(() => {
    const loadSnapshot = () => setSnapshot(readPaperTradingSnapshot());
    loadSnapshot();
    window.addEventListener("storage", loadSnapshot);
    window.addEventListener("focus", loadSnapshot);
    window.addEventListener(PAPER_TRADING_UPDATED_EVENT, loadSnapshot as EventListener);
    return () => {
      window.removeEventListener("storage", loadSnapshot);
      window.removeEventListener("focus", loadSnapshot);
      window.removeEventListener(PAPER_TRADING_UPDATED_EVENT, loadSnapshot as EventListener);
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
  const { configured, balances, refresh: refreshAccount } = useBinanceAccountStatus();

  const portfolio = useMemo(() => {
    if (!configured || balances.length === 0) return mockPortfolio;
    return buildPortfolioSnapshot(balances, coins);
  }, [configured, balances, coins]);

  return {
    portfolio,
    source: configured && balances.length > 0 ? "live" : "fallback",
    refresh: async () => {
      const [nextMarket, nextAccount] = await Promise.all([refreshMarket(), refreshAccount()]);
      const nextCoins = nextMarket?.coins ?? coins;
      const nextConfigured = nextAccount?.configured ?? configured;
      const nextBalances = nextAccount?.nonZeroBalances ?? balances;
      if (!nextConfigured || nextBalances.length === 0) return mockPortfolio;
      return buildPortfolioSnapshot(nextBalances, nextCoins);
    },
  };
}
