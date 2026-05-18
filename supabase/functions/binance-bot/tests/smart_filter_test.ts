import { assertEquals } from "jsr:@std/assert@1";
import {
  evaluateSmartNoiseFilter,
  isCapitulationTape,
  resolveAvgVolume1mFrom24h,
  resolveEffectiveMinVolRatio,
} from "../smart-filter.ts";
import { setActiveFrictionSpreadBoost } from "../professional-expectancy.ts";
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
    snapshot: baseSnapshot({ symbol: "ETHUSDT" }),
    lastCandleVolume: 0.4,
    hasOpenTrade: false,
    minVolume24hQuoteFromDb: 0,
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
  assertEquals(result.tradeRegime, "STABLE");
  assertEquals(result.sleepAi, false);
  assertEquals(result.blockBuy, true);
});

Deno.test("evaluateSmartNoiseFilter enforces chaos 1m volume floor on non-high-liq", () => {
  Deno.env.set("SMART_FILTER_ENABLED", "1");
  const result = evaluateSmartNoiseFilter({
    snapshot: baseSnapshot({
      symbol: "DOGEUSDT",
      latestPrice: 0.1,
      spreadBps: 20,
      volume24hQuote: 144_000_000,
      volume24hBase: 1_440_000_000,
    }),
    lastCandleVolume: 1,
    hasOpenTrade: false,
    minVolume24hQuoteFromDb: 0,
  });
  assertEquals(result.tradeRegime, "CHAOS");
  assertEquals(result.blockBuy, true);
  assertEquals(result.vetoReasons.includes("FAIL_LOW_1M_VOLUME_USD"), true);
});

Deno.test("evaluateSmartNoiseFilter skips strict 1m USD gate for PEPE with healthy 24h", () => {
  Deno.env.set("SMART_FILTER_ENABLED", "1");
  const result = evaluateSmartNoiseFilter({
    snapshot: baseSnapshot({
      symbol: "PEPEUSDT",
      latestPrice: 0.00001,
      spreadBps: 20,
      volume24hQuote: 144_000_000,
      volume24hBase: 14_400_000_000_000,
    }),
    lastCandleVolume: 1_000_000,
    hasOpenTrade: false,
    minVolume24hQuoteFromDb: 0,
  });
  assertEquals(result.volumeGateMode, "high_liq_24h_primary");
  assertEquals(result.vetoReasons.includes("FAIL_LOW_1M_VOLUME_USD"), false);
  assertEquals(result.blockBuy, false);
});

Deno.test("evaluateSmartNoiseFilter applies $100 1m floor for SOL when 24h DB gate not met", () => {
  Deno.env.set("SMART_FILTER_ENABLED", "1");
  const low1m = evaluateSmartNoiseFilter({
    snapshot: baseSnapshot({
      symbol: "SOLUSDT",
      latestPrice: 100,
      spreadBps: 10,
      atr14: 2,
      volume24hQuote: 1_000_000,
    }),
    lastCandleVolume: 0.5,
    hasOpenTrade: false,
    minVolume24hQuoteFromDb: 50_000_000,
  });
  assertEquals(low1m.volumeGateMode, "high_liq_relaxed_1m");
  assertEquals(low1m.minVolume1mQuoteUsdApplied, 100);
  assertEquals(low1m.blockBuy, true);

  const ok1m = evaluateSmartNoiseFilter({
    snapshot: baseSnapshot({
      symbol: "SOLUSDT",
      latestPrice: 100,
      spreadBps: 10,
      atr14: 2,
      volume24hQuote: 1_000_000,
    }),
    lastCandleVolume: 2,
    hasOpenTrade: false,
    minVolume24hQuoteFromDb: 50_000_000,
  });
  assertEquals(ok1m.blockBuy, false);
});

Deno.test("evaluateSmartNoiseFilter scales PEPE volume floor when quiet", () => {
  Deno.env.set("SMART_FILTER_ENABLED", "1");
  Deno.env.set("STRATEGY_HYBRID_GATES", "1");
  Deno.env.set("SMART_FILTER_MICRO_CAP_VOL_SCALE", "0.35");
  const result = evaluateSmartNoiseFilter({
    snapshot: baseSnapshot({
      symbol: "PEPEUSDT",
      latestPrice: 0.00001,
      spreadBps: 20,
      atr14: 0.00000001,
      avgVolume1m: 0.05,
      volume24hQuote: 144_000_000,
      volume24hBase: 14_400_000_000_000,
    }),
    lastCandleVolume: 2_500_000_000,
    hasOpenTrade: false,
  });
  assertEquals(result.tradeRegime, "CHAOS");
  assertEquals(result.blockBuy, false);
});

Deno.test("isCapitulationTape detects deep oversold near lower band", () => {
  assertEquals(
    isCapitulationTape(baseSnapshot({ rsi: 35, latestPrice: 99_100, bbLower: 99_000 })),
    true,
  );
  assertEquals(isCapitulationTape(baseSnapshot({ rsi: 50, latestPrice: 100_000 })), false);
});

Deno.test("resolveEffectiveMinVolRatio floors to 0.22 on capitulation tape", () => {
  const snap = baseSnapshot({ rsi: 35, latestPrice: 99_100, bbLower: 99_000 });
  assertEquals(
    resolveEffectiveMinVolRatio({
      snapshot: snap,
      baseRatio: 0.45,
      volume1m: 0.2,
      avgFrom24h: 1,
    }),
    0.22,
  );
});

Deno.test("capitulation tape relaxes FAIL_LOW_VOLUME_VS_24H_AVG", () => {
  Deno.env.set("SMART_FILTER_ENABLED", "1");
  const result = evaluateSmartNoiseFilter({
    snapshot: baseSnapshot({ rsi: 35, latestPrice: 99_100, bbLower: 99_000 }),
    lastCandleVolume: 0.25,
    hasOpenTrade: false,
  });
  assertEquals(result.vetoReasons.includes("FAIL_LOW_VOLUME_VS_24H_AVG"), false);
});

Deno.test("evaluateSmartNoiseFilter tightens spread cap when friction boost active", () => {
  Deno.env.set("SMART_FILTER_ENABLED", "1");
  setActiveFrictionSpreadBoost(5);
  const pass = evaluateSmartNoiseFilter({
    snapshot: baseSnapshot({ spreadBps: 14 }),
    lastCandleVolume: 2,
    hasOpenTrade: false,
  });
  const block = evaluateSmartNoiseFilter({
    snapshot: baseSnapshot({ spreadBps: 16 }),
    lastCandleVolume: 2,
    hasOpenTrade: false,
  });
  assertEquals(pass.blockBuy, false);
  assertEquals(block.blockBuy, true);
  setActiveFrictionSpreadBoost(0);
});
