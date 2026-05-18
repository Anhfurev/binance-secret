// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import {
  marketCache,
  patchWsMiniTicker,
  refreshWsMarketCacheEntry,
} from "../market-cache-ws.ts";
import { seedWsKlines } from "../ws-kline-store.ts";
import { buildCombinedStreamUrlForTest } from "../binance-stream-manager-test-helpers.ts";
import { prefetchMarket } from "../prefetch-market-stream.ts";
import type { IndicatorSnapshot } from "../types.ts";

Deno.test("buildCombinedStreamUrl includes ticker and kline streams", () => {
  const url = buildCombinedStreamUrlForTest(["BTCUSDT", "SOLUSDT"]);
  assertEquals(url.includes("btcusdt@ticker"), true);
  assertEquals(url.includes("solusdt@kline_1m"), true);
});

Deno.test("prefetchMarket sync read from global WS cache", () => {
  marketCache.clear();
  const sym = "PEPEUSDT";
  const candles = Array.from({ length: 210 }, (_, i) => ({
    openTime: 1_700_000_000_000 + i * 60_000,
    open: 1,
    high: 1.1,
    low: 0.9,
    close: 1 + i * 0.0001,
    volume: 1000,
  }));
  seedWsKlines(sym, "1m", candles);
  seedWsKlines(sym, "5m", candles.slice(-24));
  seedWsKlines(sym, "15m", candles.slice(-80));
  seedWsKlines(sym, "1h", candles.slice(-60));
  seedWsKlines(sym, "4h", candles.slice(-36));
  seedWsKlines(sym, "1d", candles.slice(-40));
  patchWsMiniTicker(sym, { last: 0.00001, high: 0.00002, low: 0.000009, quoteVolume: 1e6, baseVolume: 1e9 });
  refreshWsMarketCacheEntry(sym);

  const cycleCache = new Map<string, IndicatorSnapshot>();
  const snap = prefetchMarket(cycleCache, sym);
  assertEquals(snap?.symbol, sym);
  assertEquals(cycleCache.has(sym), true);
  assertEquals(Number(snap?.latestPrice) > 0, true);
});
