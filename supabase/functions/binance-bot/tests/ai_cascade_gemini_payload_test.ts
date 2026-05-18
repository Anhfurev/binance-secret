// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import {
  buildCascadeGeminiPayload,
  candleToOhlcvBar,
} from "../ai-cascade-gemini-payload.ts";
import type { IndicatorSnapshot } from "../types.ts";

Deno.test("buildCascadeGeminiPayload includes 15 bars and daily S/R", () => {
  const bar = {
    openTime: 1,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 100,
  };
  const snap = {
    symbol: "SOLUSDT",
    latestPrice: 150,
    rsi: 28,
    marketRegime: "RANGING",
    candles5m: Array.from({ length: 15 }, () => bar),
    candles1h: Array.from({ length: 15 }, () => bar),
    daily_support_resistance: {
      support: [140, 145],
      resistance: [155, 160],
      pivot: 150,
      method: "daily_pivot_swings",
    },
  } as IndicatorSnapshot;
  const payload = buildCascadeGeminiPayload(snap, "SOLUSDT");
  assertEquals(payload.symbol, "SOLUSDT");
  assertEquals((payload.candles_5m as unknown[]).length, 15);
  assertEquals((payload.candles_1h as unknown[]).length, 15);
  assertEquals((payload.daily_support_resistance as { support: number[] }).support.length, 2);
  const o = candleToOhlcvBar(bar);
  assertEquals(o.volume, 100);
});
