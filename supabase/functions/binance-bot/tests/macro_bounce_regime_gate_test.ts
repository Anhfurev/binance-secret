import { assertEquals } from "jsr:@std/assert";
import {
  MACRO_REGIME_ACTIVE_SHORT,
  resolveActiveShortMacroRegime,
  resolveBtcBelow4hEma21,
  resolveBtcMacroBounceGateFromMarketCache,
  resolveMacroEntryRegimeLabel,
} from "../macro-bounce-regime-gate.ts";
import type { IndicatorSnapshot } from "../types.ts";

function btcSnap(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    symbol: "BTCUSDT",
    latestPrice: 100_000,
    imbalance_ratio: 1,
    candles5: [],
    candles15: [],
    candles15m: [],
    candles1h: Array.from({ length: 30 }, (_, i) => ({
      openTime: i,
      open: 99_000 + i * 50,
      high: 100_500,
      low: 98_500,
      close: 99_000 + i * 50,
      volume: 10,
    })),
    candles4h: Array.from({ length: 25 }, (_, i) => ({
      openTime: i,
      open: 95_000,
      high: 101_000,
      low: 94_000,
      close: 96_000 + i * 200,
      volume: 100,
    })),
    trend_htf: {
      trend_1h: "bull",
      trend_4h: "bull",
      mtf_aligned: true,
      trend_15m: "bull",
      mtf_ltf_aligned: true,
      mtf_effective_ok: true,
    },
    marketRegime: "TRENDING",
    adx14: 25,
    atr14: 500,
    dayLow24h: 95_000,
    avgVolume1m: 1,
    rsi: 55,
    rsi15m: 50,
    bbLower: 98_000,
    bbMiddle: 99_500,
    bbUpper: 101_000,
    ema200: 90_000,
    ema50: 98_000,
    emaFast: 99_500,
    emaSlow: 98_500,
    macd: { macd: 1, signal: 0.5, histogram: 0.5 },
    ...overrides,
  } as IndicatorSnapshot;
}

Deno.test("macro bounce gate blocks when BTC is below 4h EMA21", () => {
  const snap = btcSnap({
    latestPrice: 90_000,
    candles4h: Array.from({ length: 25 }, () => ({
      openTime: 0,
      open: 100_000,
      high: 101_000,
      low: 99_000,
      close: 100_000,
      volume: 1,
    })),
  });
  assertEquals(resolveBtcBelow4hEma21(snap), true);
  assertEquals(resolveMacroEntryRegimeLabel(snap), MACRO_REGIME_ACTIVE_SHORT);
  const cache = new Map([["BTCUSDT", snap]]);
  const gate = resolveBtcMacroBounceGateFromMarketCache(cache);
  assertEquals(gate.blocked, true);
  assertEquals(gate.btcBelow4hEma21, true);
});

Deno.test("macro bounce gate allows when BTC is above 4h EMA21 and 1h EMA stack", () => {
  const snap = btcSnap({ latestPrice: 110_000 });
  assertEquals(resolveBtcBelow4hEma21(snap), false);
  assertEquals(resolveActiveShortMacroRegime(snap), false);
  const gate = resolveBtcMacroBounceGateFromMarketCache(new Map([["BTCUSDT", snap]]));
  assertEquals(gate.blocked, false);
});
