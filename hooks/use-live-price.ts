"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { acquireBinancePriceStream, isBinancePriceStreamActive } from "@/lib/market/binance-ws-price-hub";
import { hasValidLivePrice } from "@/lib/market/asset-equity";
import {
  getLivePriceFromCache,
  getLivePriceMeta,
  setLivePriceInCache,
  subscribeLivePrice,
} from "@/lib/market/live-price-cache";
import { normalizeTradingSymbol } from "@/lib/market/symbol";

export type UseLivePriceOptions = {
  /** Seed cache on mount (e.g. from SWR / REST) while WS warms up. */
  seedPrice?: number | null;
  enabled?: boolean;
};

export type UseLivePriceResult = {
  livePrice: number | null;
  isLoading: boolean;
  isStreamConnected: boolean;
  updatedAtMs: number | null;
  symbol: string;
};

export function useLivePrice(
  rawSymbol: string,
  options: UseLivePriceOptions = {},
): UseLivePriceResult {
  const enabled = options.enabled !== false;
  const symbol = useMemo(() => normalizeTradingSymbol(rawSymbol), [rawSymbol]);

  useEffect(() => {
    if (!enabled || !symbol) return;
    const seed = Number(options.seedPrice);
    if (hasValidLivePrice(seed)) {
      setLivePriceInCache(symbol, seed, "seed");
    }
  }, [enabled, symbol, options.seedPrice]);

  useEffect(() => {
    if (!enabled || !symbol) return;
    return acquireBinancePriceStream(symbol);
  }, [enabled, symbol]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!enabled || !symbol) return () => undefined;
      return subscribeLivePrice(symbol, onStoreChange);
    },
    [enabled, symbol],
  );

  const getSnapshot = useCallback(() => {
    if (!enabled || !symbol) return null;
    return getLivePriceFromCache(symbol);
  }, [enabled, symbol]);

  const getServerSnapshot = useCallback(() => {
    const seed = Number(options.seedPrice);
    return hasValidLivePrice(seed) ? seed : null;
  }, [options.seedPrice]);

  const livePrice = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const meta = enabled && symbol ? getLivePriceMeta(symbol) : null;
  const streamConnected = enabled && symbol ? isBinancePriceStreamActive(symbol) : false;
  const hasPrice = hasValidLivePrice(livePrice);
  const isLoading = enabled && symbol.length > 0 && !hasPrice;

  return {
    livePrice: hasPrice ? Number(livePrice) : null,
    isLoading,
    isStreamConnected: streamConnected,
    updatedAtMs: meta?.updatedAtMs ?? null,
    symbol,
  };
}
