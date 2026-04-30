"use client";

import useSWR from "swr";
import type {
  AlertsResponse,
  BinanceAccountStatusResponse,
  FuturesSignalsApiResponse,
  GrowthResponse,
  MarketResponse,
  PredictionsResponse,
  SentimentResponse,
  SignalsResponse,
  WhaleResponse,
} from "@/hooks/dashboard-data/types";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return payload;
};

export function useMarketData() {
  const { data, error, isLoading, mutate } = useSWR<MarketResponse>("/api/market", fetcher, {
    refreshInterval: 60000,
    revalidateOnFocus: false,
  });
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
  const { data, error, isLoading, mutate } = useSWR<GrowthResponse>("/api/growth", fetcher, {
    refreshInterval: 60000,
    revalidateOnFocus: false,
  });
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
  const { data, error, isLoading, mutate } = useSWR<SentimentResponse>("/api/sentiment", fetcher, {
    refreshInterval: 300000,
    revalidateOnFocus: false,
  });
  return {
    sentiment: data?.sentiment ?? { fearGreedIndex: 50, fearGreedLabel: "Neutral", socialSentiment: 50, socialSentimentLabel: "Neutral" },
    news: data?.news ?? [],
    source: data?.source ?? "fallback",
    lastUpdated: data?.lastUpdated ? new Date(data.lastUpdated) : null,
    isLoading,
    error,
    refresh: mutate,
  };
}

export function useAlerts() {
  const { data, error, isLoading, mutate } = useSWR<AlertsResponse>("/api/alerts", fetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: false,
  });
  return { alerts: data?.alerts ?? [], source: data?.source ?? "fallback", lastUpdated: data?.lastUpdated ? new Date(data.lastUpdated) : null, isLoading, error, refresh: mutate };
}

export function useWhaleActivity() {
  const { data, error, isLoading, mutate } = useSWR<WhaleResponse>("/api/whale", fetcher, {
    refreshInterval: 60000,
    revalidateOnFocus: false,
  });
  return {
    transactions: (data?.transactions ?? []).map((tx) => ({ ...tx, timestamp: new Date(tx.timestamp) })),
    generatedAt: data?.generatedAt ? new Date(data.generatedAt) : null,
    isLoading,
    error,
    refresh: async () => {
      const next = await mutate();
      return (next?.transactions ?? []).map((tx) => ({ ...tx, timestamp: new Date(tx.timestamp) }));
    },
  };
}

export function useSignalsData() {
  const { data, error, isLoading, mutate } = useSWR<SignalsResponse>("/api/signals", fetcher, {
    refreshInterval: 120000,
    revalidateOnFocus: false,
  });
  return {
    signals: data?.signals ?? [],
    source: data?.source ?? "fallback",
    computed: data?.computed ?? false,
    lastUpdated: data?.lastUpdated ? new Date(data.lastUpdated) : null,
    isLoading,
    error,
    refresh: async () => (await mutate())?.signals ?? [],
  };
}

export function usePredictionsData() {
  const { data, error, isLoading, mutate } = useSWR<PredictionsResponse>("/api/predictions", fetcher, {
    refreshInterval: 300000,
    revalidateOnFocus: false,
  });
  return {
    predictions: data?.predictions ?? [],
    source: data?.source ?? "fallback",
    computed: data?.computed ?? false,
    lastUpdated: data?.lastUpdated ? new Date(data.lastUpdated) : null,
    isLoading,
    error,
    refresh: async () => (await mutate())?.predictions ?? [],
  };
}

export function useFuturesSignals() {
  const { data, error, isLoading, mutate } = useSWR<FuturesSignalsApiResponse>(
    "/api/futures/signals",
    fetcher,
    { refreshInterval: 60000, revalidateOnFocus: false },
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

export function useBinanceAccountStatus() {
  const { data, error, isLoading, mutate } = useSWR<BinanceAccountStatusResponse>(
    "/api/binance/account",
    fetcher,
    { refreshInterval: 120000, revalidateOnFocus: false },
  );
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
