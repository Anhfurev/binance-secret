import { assertEquals } from "jsr:@std/assert";
import { buildTechnicalIndicatorFallback } from "../ai-technical-fallback.ts";
import type { IndicatorSnapshot } from "../types.ts";

function snap(partial: Partial<IndicatorSnapshot>): IndicatorSnapshot {
  return {
    symbol: "PEPEUSDT",
    latestPrice: 1,
    rsi: 50,
    emaFast: 1,
    emaSlow: 1,
    ema200: 1,
    avgVolume1m: 100,
    imbalance_ratio: 1,
    candles5: [{ open: 1, high: 1, low: 1, close: 1, volume: 150 }],
    marketRegime: "NEUTRAL",
    ...partial,
  } as IndicatorSnapshot;
}

Deno.test("technical fallback BUY on oversold + volume", () => {
  const ai = buildTechnicalIndicatorFallback(
    snap({ rsi: 38, imbalance_ratio: 1.1 }),
  );
  assertEquals(ai.action, "BUY");
  assertEquals(ai.groq_verdict, "TECH_FALLBACK");
});

Deno.test("technical fallback SELL on RSI overbought", () => {
  const ai = buildTechnicalIndicatorFallback(snap({ rsi: 74 }));
  assertEquals(ai.action, "SELL");
});
