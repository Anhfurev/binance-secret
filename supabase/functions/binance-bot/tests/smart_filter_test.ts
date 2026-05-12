import { assertEquals } from "jsr:@std/assert@1";
import {
  evaluateSmartNoiseFilter,
  resolveAvgVolume1mFrom24h,
} from "../smart-filter.ts";
import type { IndicatorSnapshot } from "../types.ts";

function baseSnapshot(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    symbol: "BTCUSDT",
    latestPrice: 100_000,
    imbalance_ratio: 1,
    candles5: [],
    candles15: [],
    candles15m: [],
    candles1h: [],
    candles4h: [],
    trend_htf: {
      trend_1h: "flat",
      trend_4h: "flat",
      mtf_aligned: true,
      trend_15m: "flat",
      mtf_ltf_aligned: true,
      mtf_effective_ok: true,
    },
    marketRegime: "NEUTRAL",
    adx14: 20,
    atr14: 100,
    dayLow24h: 99_000,
    volume24hQuote: 144_000_000,
    volume24hBase: 1440,
    spreadBps: 5,
    avgVolume1m: 2,
    rsi: 50,
    rsi15m: 50,
    bbLower: 99_000,
    bbMiddle: 100_000,
    bbUpper: 101_000,
    ema200: 99_500,
    ema50: 100_000,
    emaFast: 100_000,
    emaSlow: 99_900,
    macd: { macd: 0, signal: 0, histogram: 0 },
    ...overrides,
  };
}

Deno.test("resolveAvgVolume1mFrom24h uses 24h base volume", () => {
  const avg = resolveAvgVolume1mFrom24h(baseSnapshot());
  assertEquals(avg, 1);
});

Deno.test("evaluateSmartNoiseFilter sleeps AI on low 1m volume", () => {
  Deno.env.set("SMART_FILTER_ENABLED", "1");
  const result = evaluateSmartNoiseFilter({
    snapshot: baseSnapshot(),
    lastCandleVolume: 0.4,
    hasOpenTrade: false,
  });
  assertEquals(result.sleepAi, true);
  assertEquals(result.blockBuy, false);
});

Deno.test("evaluateSmartNoiseFilter blocks buy on wide spread", () => {
  Deno.env.set("SMART_FILTER_ENABLED", "1");
  const result = evaluateSmartNoiseFilter({
    snapshot: baseSnapshot({ spreadBps: 80 }),
    lastCandleVolume: 2,
    hasOpenTrade: false,
  });
  assertEquals(result.sleepAi, false);
  assertEquals(result.blockBuy, true);
});
