// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import { buildPayload } from "../ai-core.ts";
import type { Candle, IndicatorSnapshot } from "../types.ts";

function mkCandle(t: number, c: number): Candle {
  return { openTime: t, open: c, high: c * 1.001, low: c * 0.999, close: c, volume: 1 };
}

Deno.test("buildPayload uses compact 1m tuples and caps bar count", () => {
  const prev = Deno.env.get("GROQ_AI_BARS_1M");
  try {
    Deno.env.set("GROQ_AI_BARS_1M", "10");
    const m1: Candle[] = Array.from({ length: 20 }, (_, i) => mkCandle(1000 + i, 100 + i));
    const snap = {
      symbol: "BTCUSDT",
      latestPrice: 120,
      imbalance_ratio: 1,
      candles5: m1.slice(-5),
      candles15: m1,
      candles15m: [mkCandle(1, 110)],
      candles1h: [mkCandle(2, 115)],
      candles4h: [mkCandle(3, 118)],
      trend_htf: {
        trend_1h: "flat",
        trend_4h: "flat",
        mtf_aligned: true,
        trend_15m: "flat",
        mtf_ltf_aligned: true,
        mtf_effective_ok: true,
      },
      marketRegime: "NEUTRAL",
      adx14: 18,
      atr14: 1,
      dayLow24h: 90,
      avgVolume1m: 1,
      rsi: 50,
      rsi15m: 50,
      bbLower: 80,
      bbMiddle: 100,
      bbUpper: 120,
      ema200: 90,
      ema50: 100,
      emaFast: 101,
      emaSlow: 99,
      macd: { macd: 0, signal: 0, histogram: 0 },
    } as IndicatorSnapshot;
    const p = buildPayload(snap, "BTCUSDT", null) as Record<string, unknown>;
    const c1m = p.candles1m as number[][];
    assertEquals(c1m.length, 10);
    assertEquals(Array.isArray(c1m[0]), true);
    assertEquals(c1m[0].length, 6);
    assertEquals("ai_scoring_rubric" in p, false);
  } finally {
    if (prev === undefined) Deno.env.delete("GROQ_AI_BARS_1M");
    else Deno.env.set("GROQ_AI_BARS_1M", prev);
  }
});

Deno.test("buildPayload includes ai_scoring_rubric when AI_LLM_INCLUDE_SCORING_RUBRIC=1", () => {
  const prev = Deno.env.get("AI_LLM_INCLUDE_SCORING_RUBRIC");
  try {
    Deno.env.set("AI_LLM_INCLUDE_SCORING_RUBRIC", "1");
    const m1 = [mkCandle(1, 100), mkCandle(2, 101)];
    const snap = {
      symbol: "BTCUSDT",
      latestPrice: 101,
      imbalance_ratio: 1,
      candles5: m1,
      candles15: m1,
      candles15m: m1,
      candles1h: m1,
      candles4h: m1,
      trend_htf: {
        trend_1h: "flat",
        trend_4h: "flat",
        mtf_aligned: true,
        trend_15m: "flat",
        mtf_ltf_aligned: true,
        mtf_effective_ok: true,
      },
      marketRegime: "NEUTRAL",
      adx14: 18,
      atr14: 1,
      dayLow24h: 90,
      avgVolume1m: 1,
      rsi: 50,
      rsi15m: 50,
      bbLower: 80,
      bbMiddle: 100,
      bbUpper: 120,
      ema200: 90,
      ema50: 100,
      emaFast: 101,
      emaSlow: 99,
      macd: { macd: 0, signal: 0, histogram: 0 },
    } as IndicatorSnapshot;
    const p = buildPayload(snap, "BTCUSDT", null) as Record<string, unknown>;
    assertEquals(typeof p.ai_scoring_rubric, "object");
  } finally {
    if (prev === undefined) Deno.env.delete("AI_LLM_INCLUDE_SCORING_RUBRIC");
    else Deno.env.set("AI_LLM_INCLUDE_SCORING_RUBRIC", prev);
  }
});
