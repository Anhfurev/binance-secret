import { assertEquals } from "jsr:@std/assert@1";
import {
  allowsAdaptiveNeutralRsiBuy,
  allowsEma200HybridBypass,
  isLowVolatilityQuiet,
  isMicroCapSymbol,
  isTrendingOrBullishSnapshot,
  resolveScaledSmartFilterFloors,
} from "../strategy-hybrid-gates.ts";
import type { IndicatorSnapshot } from "../types.ts";

function snap(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    symbol: "PEPEUSDT",
    latestPrice: 0.00001,
    imbalance_ratio: 1,
    candles5: [],
    candles15: [],
    candles15m: [],
    candles1h: [],
    candles4h: [],
    trend_htf: { trend_1h: "bull", trend_4h: "flat", mtf_aligned: true, trend_15m: "bull", mtf_ltf_aligned: true, mtf_effective_ok: true },
    marketRegime: "TRENDING",
    adx14: 24,
    atr14: 0.00000002,
    dayLow24h: 0.000009,
    volume24hQuote: 50_000_000,
    volume24hBase: 5_000_000_000_000,
    spreadBps: 20,
    avgVolume1m: 0.2,
    rsi: 54,
    rsi15m: 52,
    bbLower: 0.0000095,
    bbMiddle: 0.00001,
    bbUpper: 0.0000105,
    ema200: 0.0000102,
    ema50: 0.0000099,
    emaFast: 0.00001,
    emaSlow: 0.0000098,
    macd: { macd: 0, signal: 0, histogram: 0 },
    ...overrides,
  };
}

Deno.test("isTrendingOrBullishSnapshot accepts TRENDING and HTF bull", () => {
  Deno.env.set("STRATEGY_HYBRID_GATES", "1");
  assertEquals(isTrendingOrBullishSnapshot(snap()), true);
  assertEquals(
    isTrendingOrBullishSnapshot(snap({ marketRegime: "NEUTRAL", adx14: 10, trend_htf: undefined })),
    false,
  );
});

Deno.test("allowsEma200HybridBypass for momentum strategy below EMA200", () => {
  Deno.env.set("STRATEGY_HYBRID_GATES", "1");
  const ok = allowsEma200HybridBypass({
    snapshot: snap(),
    strategySignal: "BUY",
    strategyReason: "strategy_hybrid_breakout_entry",
    technicalScore: 7,
    aiConfidence: 70,
  });
  assertEquals(ok, true);
});

Deno.test("allowsAdaptiveNeutralRsiBuy when AI confidence high and RSI neutral", () => {
  Deno.env.set("STRATEGY_HYBRID_GATES", "1");
  Deno.env.set("STRATEGY_ADAPTIVE_RSI_MIN_AI", "65");
  assertEquals(
    allowsAdaptiveNeutralRsiBuy({
      rsi: 54,
      aiConfidence: 68,
      strategyBuyRsiThreshold: 53,
      marketRegime: "TRENDING",
      strategySignal: "BUY",
    }),
    true,
  );
  assertEquals(
    allowsAdaptiveNeutralRsiBuy({
      rsi: 54,
      aiConfidence: 60,
      strategyBuyRsiThreshold: 53,
      marketRegime: "TRENDING",
      strategySignal: "BUY",
    }),
    false,
  );
});

Deno.test("resolveScaledSmartFilterFloors lowers PEPE floors in quiet tape", () => {
  Deno.env.set("STRATEGY_HYBRID_GATES", "1");
  Deno.env.set("SMART_FILTER_MICRO_CAP_VOL_SCALE", "0.35");
  assertEquals(isMicroCapSymbol("PEPEUSDT"), true);
  const quiet = snap({ atr14: 0.00000001, avgVolume1m: 0.05 });
  assertEquals(isLowVolatilityQuiet(quiet), true);
  const scaled = resolveScaledSmartFilterFloors({
    snapshot: quiet,
    tradeRegime: "CHAOS",
    baseMinVolVs24hAvg: 0.45,
    baseMinVolume1mQuoteUsd: 50_000,
  });
  assertEquals(scaled.minVolume1mQuoteUsd < 50_000, true);
  assertEquals(scaled.minVolVs24hAvg < 0.45, true);
});
