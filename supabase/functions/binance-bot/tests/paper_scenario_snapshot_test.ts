import { assertEquals } from "jsr:@std/assert";
import { checkEntryConditions } from "../strategy.ts";
import {
  applyPaperScenarioOverlay,
  buildPaperScenarioAiStub,
} from "../paper-scenario-snapshot.ts";

Deno.test("momentum scenario yields strategy BUY signal", () => {
  const base = {
    symbol: "SOLUSDT",
    latestPrice: 100,
    imbalance_ratio: 1,
    candles5: [],
    candles15: [],
    candles15m: [],
    candles1h: [],
    candles4h: [],
    trend_htf: {
      trend_1h: "bull",
      trend_4h: "bull",
      mtf_aligned: true,
      trend_15m: "bull",
      mtf_ltf_aligned: true,
      mtf_effective_ok: true,
    },
    marketRegime: "NEUTRAL",
    adx14: 20,
    atr14: 1,
    dayLow24h: 95,
    avgVolume1m: 100,
    rsi: 50,
    rsi15m: 50,
    bbLower: 98,
    bbMiddle: 100,
    bbUpper: 102,
    ema200: 99,
    ema50: 99,
    emaFast: 99,
    emaSlow: 100,
    macd: { macd: 0, signal: 0, histogram: 0 },
  };
  const snap = applyPaperScenarioOverlay(base as any, "momentum_buy");
  const entry = checkEntryConditions(snap as any);
  assertEquals(entry.signal, "BUY");
});

Deno.test("momentum scenario still buys when live rsi is overstretched", () => {
  const base = {
    symbol: "SOLUSDT",
    latestPrice: 100,
    imbalance_ratio: 1,
    candles5: [],
    candles15: [],
    candles15m: [],
    candles1h: [],
    candles4h: [],
    trend_htf: {
      trend_1h: "bull",
      trend_4h: "bull",
      mtf_aligned: true,
      trend_15m: "bull",
      mtf_ltf_aligned: true,
      mtf_effective_ok: true,
    },
    marketRegime: "NEUTRAL",
    adx14: 20,
    atr14: 1,
    dayLow24h: 95,
    avgVolume1m: 100,
    rsi: 78,
    rsi15m: 76,
    bbLower: 98,
    bbMiddle: 100,
    bbUpper: 102,
    ema200: 99,
    ema50: 99,
    emaFast: 98,
    emaSlow: 101,
    macd: { macd: 0, signal: 0.1, histogram: -0.1 },
  };
  const snap = applyPaperScenarioOverlay(base as any, "momentum_buy");
  const entry = checkEntryConditions(snap as any);
  assertEquals(entry.signal, "BUY");
});

Deno.test("oversold scenario yields BBRSI BUY signal", () => {
  const base = {
    symbol: "BTCUSDT",
    latestPrice: 100,
    imbalance_ratio: 1,
    candles5: [],
    candles15: [],
    candles15m: [],
    candles1h: [],
    candles4h: [],
    trend_htf: {
      trend_1h: "bull",
      trend_4h: "bull",
      mtf_aligned: true,
      trend_15m: "bull",
      mtf_ltf_aligned: true,
      mtf_effective_ok: true,
    },
    marketRegime: "RANGING",
    adx14: 15,
    atr14: 1,
    dayLow24h: 95,
    avgVolume1m: 100,
    rsi: 50,
    rsi15m: 50,
    bbLower: 100,
    bbMiddle: 101,
    bbUpper: 102,
    ema200: 99,
    ema50: 99,
    emaFast: 99,
    emaSlow: 100,
    macd: { macd: 0, signal: 0, histogram: 0 },
  };
  const snap = applyPaperScenarioOverlay(base as any, "oversold_buy");
  const entry = checkEntryConditions(snap as any);
  assertEquals(entry.signal, "BUY");
});

Deno.test("oversold scenario clears weak live technical score", () => {
  const base = {
    symbol: "BTCUSDT",
    latestPrice: 100,
    imbalance_ratio: 1,
    candles5: [],
    candles15: [],
    candles15m: [],
    candles1h: [],
    candles4h: [],
    trend_htf: {
      trend_1h: "bull",
      trend_4h: "bull",
      mtf_aligned: true,
      trend_15m: "bull",
      mtf_ltf_aligned: true,
      mtf_effective_ok: true,
    },
    marketRegime: "RANGING",
    adx14: 15,
    atr14: 1,
    dayLow24h: 95,
    avgVolume1m: 100,
    rsi: 55,
    rsi15m: 55,
    bbLower: 100,
    bbMiddle: 101,
    bbUpper: 102,
    ema200: 101,
    ema50: 100.5,
    emaFast: 99,
    emaSlow: 100,
    macd: { macd: -0.2, signal: 0.1, histogram: -0.3 },
  };
  const snap = applyPaperScenarioOverlay(base as any, "oversold_buy");
  const entry = checkEntryConditions(snap as any);
  assertEquals(entry.signal, "BUY");
});

Deno.test("paper scenario ai stub confirms BUY with high confidence", () => {
  const ai = buildPaperScenarioAiStub(78, {
    ai_confidence: 81,
    trend: "neutral",
    trend_alignment: true,
    action: "HOLD",
    ai_provider: "cache",
    ai_cache_status: "hit",
  });
  assertEquals(ai.action, "BUY");
  if (Number(ai.ai_confidence) < 81) {
    throw new Error(`expected blended confidence, got ${ai.ai_confidence}`);
  }
});
