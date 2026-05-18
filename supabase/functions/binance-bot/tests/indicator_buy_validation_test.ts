import { assertEquals } from "jsr:@std/assert";
import {
  validateBuyIndicatorFootprint,
  INVALID_ZERO_FOOTPRINT_DETAIL,
} from "../indicator-buy-validation.ts";
import type { IndicatorSnapshot } from "../types.ts";

function baseSnapshot(): IndicatorSnapshot {
  return {
    symbol: "SOLUSDT",
    latestPrice: 150,
    rsi: 55,
    emaFast: 149,
    emaSlow: 148,
    ema200: 140,
    atr14: 2.5,
    adx14: 25,
    macd: 0.5,
    macdSignal: 0.3,
    macdHistogram: 0.2,
    marketRegime: "TRENDING",
    bbLower: 145,
    bbMiddle: 150,
    bbUpper: 155,
  } as unknown as IndicatorSnapshot;
}

Deno.test("validateBuyIndicatorFootprint accepts healthy snapshot", () => {
  const r = validateBuyIndicatorFootprint(baseSnapshot());
  assertEquals(r.ok, true);
});

Deno.test("validateBuyIndicatorFootprint blocks zero price", () => {
  const snap = baseSnapshot();
  snap.latestPrice = 0;
  const r = validateBuyIndicatorFootprint(snap);
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.detail.includes(INVALID_ZERO_FOOTPRINT_DETAIL), true);
    assertEquals(r.codes.includes("PRICE_INVALID"), true);
  }
});
