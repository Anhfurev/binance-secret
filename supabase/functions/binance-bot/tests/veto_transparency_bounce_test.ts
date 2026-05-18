import { assertEquals } from "jsr:@std/assert";
import { collectPreflightVetoChecks } from "../veto-transparency.ts";
import { resolveRegimeGatePolicy } from "../dynamic-regime-switcher.ts";
import type { IndicatorSnapshot } from "../types.ts";

function snap(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    symbol: "SOLUSDT",
    latestPrice: 99_000,
    imbalance_ratio: 1,
    candles5: [{ openTime: 0, open: 1, high: 1, low: 1, close: 99_000, volume: 2 }],
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
    marketRegime: "TRENDING",
    adx14: 28,
    atr14: 80,
    dayLow24h: 98_000,
    volume24hQuote: 2_000_000,
    volume24hBase: 20,
    spreadBps: 5,
    avgVolume1m: 2,
    rsi: 32,
    rsi15m: 34,
    bbLower: 98_500,
    bbMiddle: 100_000,
    bbUpper: 101_500,
    ema200: 101_000,
    ema50: 99_500,
    emaFast: 99_800,
    emaSlow: 99_700,
    macd: { macd: -1, signal: 0, histogram: -1 },
    ...overrides,
  };
}

Deno.test("preflight ema200 passes for strategy_oversold_bounce_entry below EMA200", () => {
  const gatePolicy = resolveRegimeGatePolicy("REGIME_TRENDING");
  const preflight = collectPreflightVetoChecks({
    snapshot: snap(),
    technicalScore: 7,
    aggressiveModeEnabled: false,
    strategySignal: "BUY",
    minTechnicalScore: 5,
    strategyReason: "strategy_oversold_bounce_entry",
    gatePolicy,
  });
  assertEquals(preflight.scorecard.ema200, true);
  assertEquals(preflight.veto_reasons.includes("FAIL_EMA200"), false);
});

Deno.test("preflight ema200 still fails for trend entry below EMA200", () => {
  const gatePolicy = resolveRegimeGatePolicy("REGIME_TRENDING");
  const preflight = collectPreflightVetoChecks({
    snapshot: snap({
      latestPrice: 97_000,
      ema200: 101_000,
      ema50: 100_000,
      rsi: 48,
      candles5: [
        { openTime: 0, open: 1, high: 1, low: 1, close: 97_000, volume: 2 },
        { openTime: 1, open: 1, high: 1, low: 1, close: 96_900, volume: 2 },
        { openTime: 2, open: 1, high: 1, low: 1, close: 96_800, volume: 2 },
      ],
    }),
    technicalScore: 7,
    aggressiveModeEnabled: false,
    strategySignal: "BUY",
    minTechnicalScore: 5,
    strategyReason: "strategy_trend_follow",
    gatePolicy,
  });
  assertEquals(preflight.scorecard.ema200, false);
  assertEquals(preflight.veto_reasons.includes("FAIL_EMA200"), true);
});
