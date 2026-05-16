import { assertEquals } from "jsr:@std/assert@1";
import {
  detectDynamicTradingRegime,
  evaluateTrendingDefensiveGates,
  passesRegimeEma200Gate,
  resolveGrinderTakeProfitPct,
  resolveRegimeGatePolicy,
  trySidewaysGrinderEntry,
} from "../dynamic-regime-switcher.ts";
import type { IndicatorSnapshot } from "../types.ts";

function snap(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    symbol: "BTCUSDT",
    latestPrice: 100_000,
    imbalance_ratio: 1,
    candles5: [{ openTime: 0, open: 1, high: 1, low: 1, close: 100_000, volume: 2 }],
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
    marketRegime: "RANGING",
    adx14: 16,
    atr14: 80,
    dayLow24h: 99_000,
    volume24hQuote: 2_000_000,
    volume24hBase: 20,
    spreadBps: 5,
    avgVolume1m: 2,
    rsi: 38,
    rsi15m: 40,
    bbLower: 99_200,
    bbMiddle: 100_000,
    bbUpper: 100_800,
    ema200: 101_000,
    ema50: 99_800,
    emaFast: 99_950,
    emaSlow: 99_900,
    macd: { macd: 5, signal: 2, histogram: 3 },
    ...overrides,
  };
}

Deno.test("detectDynamicTradingRegime classifies sideways consolidation", () => {
  Deno.env.set("DYNAMIC_REGIME_SWITCHER", "1");
  Deno.env.set("DYNAMIC_REGIME_ADX_TREND", "22");
  Deno.env.set("DYNAMIC_REGIME_ADX_SIDEWAYS", "20");
  const diag = detectDynamicTradingRegime(snap());
  assertEquals(diag.regime, "REGIME_SIDEWAYS");
  assertEquals(diag.telemetry.includes("dyn_regime=REGIME_SIDEWAYS"), true);
});

Deno.test("sideways policy disables EMA200 and sets grinder TP", () => {
  const policy = resolveRegimeGatePolicy("REGIME_SIDEWAYS");
  assertEquals(policy.ema200Required, false);
  assertEquals(policy.grinderTakeProfitPct != null, true);
  const emaOk = passesRegimeEma200Gate({
    policy,
    snapshot: snap({ latestPrice: 99_000, ema200: 101_000 }),
    strategySignal: "BUY",
  });
  assertEquals(emaOk, true);
});

Deno.test("trySidewaysGrinderEntry fires on RSI dip in range", () => {
  Deno.env.set("DYNAMIC_REGIME_SWITCHER", "1");
  Deno.env.set("REGIME_SIDEWAYS_RSI_ENTRY_MAX", "42");
  const policy = resolveRegimeGatePolicy("REGIME_SIDEWAYS");
  const entry = trySidewaysGrinderEntry(snap({ rsi: 40 }), policy);
  assertEquals(entry?.strategy_reason, "strategy_sideways_grinder_entry");
});

Deno.test("trending defensive gates require MACD expansion", () => {
  const policy = resolveRegimeGatePolicy("REGIME_TRENDING");
  const fail = evaluateTrendingDefensiveGates({
    policy,
    snapshot: snap({
      marketRegime: "TRENDING",
      adx14: 28,
      latestPrice: 99_000,
      ema200: 101_000,
      macd: { macd: -1, signal: 0, histogram: -1 },
    }),
    strategySignal: "BUY",
  });
  assertEquals(fail.ok, false);
  assertEquals(fail.failCodes.includes("FAIL_MACD_HIST_FLAT"), true);
});

Deno.test("resolveGrinderTakeProfitPct for sideways BUY", () => {
  const policy = resolveRegimeGatePolicy("REGIME_SIDEWAYS");
  const tp = resolveGrinderTakeProfitPct({
    policy,
    strategyReason: "strategy_sideways_grinder_entry",
    decision: "BUY",
  });
  assertEquals(tp != null && tp >= 0.8 && tp <= 1.2, true);
});
