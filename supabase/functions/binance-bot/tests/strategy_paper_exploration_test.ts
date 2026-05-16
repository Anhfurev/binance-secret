import { assertEquals } from "jsr:@std/assert";
import { checkEntryConditions } from "../strategy.ts";
import type { IndicatorSnapshot } from "../types.ts";

function snap(over: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    symbol: "BTCUSDT",
    latestPrice: 100_500,
    imbalance_ratio: 1,
    candles5: [
      { openTime: 1, open: 100_000, high: 100_200, low: 99_900, close: 100_050, volume: 10 },
      { openTime: 2, open: 100_050, high: 100_250, low: 99_950, close: 100_100, volume: 12 },
      { openTime: 3, open: 100_100, high: 100_300, low: 100_000, close: 100_200, volume: 11 },
    ],
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
    adx14: 14,
    atr14: 50,
    dayLow24h: 99_000,
    avgVolume1m: 10,
    /** Above typical `resolveStrategyBuyRsiMax()` (env/DB) so live path stays HOLD; paper exploration still allows BUY up to RSI 63. */
    rsi: 62,
    rsi15m: 50,
    bbLower: 99_000,
    bbMiddle: 100_000,
    bbUpper: 101_000,
    ema200: 98_000,
    ema50: 99_800,
    emaFast: 100_050,
    emaSlow: 99_900,
    macd: { macd: 0, signal: 0, histogram: 0 },
    ...over,
  } as IndicatorSnapshot;
}

Deno.test("checkEntryConditions paperExploration can emit BUY on soft momentum", () => {
  const hold = checkEntryConditions(snap(), {});
  assertEquals(hold.signal, "HOLD");
  const buy = checkEntryConditions(snap(), { paperExploration: true });
  assertEquals(buy.signal, "BUY");
  assertEquals(buy.strategy_reason, "strategy_paper_exploration_entry");
});
