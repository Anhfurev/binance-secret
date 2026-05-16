import { assertEquals } from "jsr:@std/assert";
import type { IndicatorSnapshot } from "../types.ts";
import { resolveBtcOverboughtFromMarketCache } from "../market-anchor.ts";

function btcSnap(rsi: number): IndicatorSnapshot {
  return {
    symbol: "BTCUSDT",
    rsi,
    latestPrice: 90_000,
    emaFast: 100,
    emaSlow: 90,
    ema200: 80,
  } as IndicatorSnapshot;
}

Deno.test("resolveBtcOverboughtFromMarketCache uses preflight cache only", () => {
  const cache = new Map<string, IndicatorSnapshot>();
  assertEquals(resolveBtcOverboughtFromMarketCache(cache), false);
  cache.set("BTCUSDT", btcSnap(75));
  assertEquals(resolveBtcOverboughtFromMarketCache(cache), true);
  cache.set("BTCUSDT", btcSnap(50));
  assertEquals(resolveBtcOverboughtFromMarketCache(cache), false);
});
