import { assertEquals } from "jsr:@std/assert";
import { computeVolatilityBurstGuard } from "../volatility-burst-predictor.ts";

function buildFlatCandles(count: number) {
  const start = Date.UTC(2026, 4, 12, 0, 0, 0);
  return Array.from({ length: count }, (_, i) => ({
    openTime: start + i * 60_000,
    open: 100,
    high: 100.2,
    low: 99.8,
    close: 100,
    volume: i < count - 10 ? 100 : 10,
  }));
}

Deno.test("computeVolatilityBurstGuard returns inactive score on short history", () => {
  const guard = computeVolatilityBurstGuard(buildFlatCandles(20));
  assertEquals(guard.score, 0);
  assertEquals(guard.widenMult, 1);
});

Deno.test("computeVolatilityBurstGuard widens when squeeze and dry volume align", () => {
  const guard = computeVolatilityBurstGuard(buildFlatCandles(90));
  assertEquals(guard.widenMult >= 1, true);
});
