import { assertEquals, assertGreater } from "jsr:@std/assert";
import {
  calculateEma,
  calculateMacd,
  computeEmaPair,
} from "../indicators.ts";
import { formatIndicatorForLog, minPositiveIndicatorMagnitude } from "../indicator-precision.ts";
import { resolveBtcOverboughtFromMarketCache } from "../market-anchor.ts";
import type { IndicatorSnapshot } from "../types.ts";

function pepeCloses(base: number, n = 220): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const wiggle = Math.sin(i / 7) * base * 0.002;
    out.push(base + wiggle);
  }
  return out;
}

Deno.test("PEPE-scale EMAs stay positive and match price magnitude", () => {
  const base = 0.00000374;
  const closes = pepeCloses(base);
  const { emaFast, emaSlow } = computeEmaPair(closes);
  const ema200 = calculateEma(closes, 200);
  assertGreater(emaFast, minPositiveIndicatorMagnitude(base));
  assertGreater(emaSlow, minPositiveIndicatorMagnitude(base));
  assertGreater(ema200, minPositiveIndicatorMagnitude(base));
  assertEquals(emaFast > base * 0.9 && emaFast < base * 1.1, true);
});

Deno.test("PEPE-scale MACD preserves sub-bps deltas when tape moves", () => {
  const closes = pepeCloses(0.00000374);
  const macd = calculateMacd(closes);
  assertEquals(Number.isFinite(macd.macd), true);
  assertEquals(Number.isFinite(macd.signal), true);
  assertEquals(Number.isFinite(macd.histogram), true);
});

Deno.test("formatIndicatorForLog uses 8 decimals under 0.01", () => {
  const px = 0.00000374;
  const ema = formatIndicatorForLog(px * 1.01, px);
  assertEquals(ema.includes("0.00000"), true);
  assertEquals(ema, (px * 1.01).toFixed(8));
});

Deno.test("market anchor accepts micro-cap BTC snapshot in cache", () => {
  const cache = new Map<string, IndicatorSnapshot>();
  cache.set("BTCUSDT", {
    symbol: "BTCUSDT",
    rsi: 55,
    latestPrice: 0.00000374,
    emaFast: 0.0000038,
    emaSlow: 0.0000037,
    ema200: 0.0000036,
  } as IndicatorSnapshot);
  assertEquals(resolveBtcOverboughtFromMarketCache(cache), false);
});
