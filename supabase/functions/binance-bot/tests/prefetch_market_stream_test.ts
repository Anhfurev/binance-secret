import { assertEquals } from "jsr:@std/assert";
import { lookupMarketSnapshot } from "../prefetch-market-stream.ts";
import type { IndicatorSnapshot } from "../types.ts";

Deno.test("lookupMarketSnapshot is synchronous map read", () => {
  const cache = new Map<string, IndicatorSnapshot>();
  const snap = { symbol: "SOLUSDT", latestPrice: 100 } as IndicatorSnapshot;
  cache.set("SOLUSDT", snap);
  assertEquals(lookupMarketSnapshot(cache, "SOLUSDT"), snap);
  assertEquals(lookupMarketSnapshot(cache, "solusdt"), snap);
  assertEquals(lookupMarketSnapshot(cache, "BTCUSDT"), null);
});
