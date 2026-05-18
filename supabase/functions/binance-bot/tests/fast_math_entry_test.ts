// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import { computeFastLaneNotionalUsd } from "../binance-futures-client.ts";
import { evaluateFastMathBounceEntry } from "../fast-math-entry.ts";

Deno.test("computeFastLaneNotionalUsd clears 5 USDT min", () => {
  const n = computeFastLaneNotionalUsd({
    market_regime: "NEUTRAL",
    allowed_leverage: 10,
    global_trade_multiplier: 1,
  }, 27);
  assertEquals(n, 5.5);
});

Deno.test("evaluateFastMathBounceEntry matches oversold bounce snapshot", () => {
  const snap = {
    symbol: "BTCUSDT",
    latestPrice: 90_000,
    rsi: 32,
    bbLower: 89_500,
    bbMiddle: 91_000,
    bbUpper: 92_500,
    emaFast: 90_100,
    emaSlow: 89_900,
    ema50: 90_000,
    ema200: 95_000,
    macd: { macd: 1, signal: 0.5, histogram: 0.1 },
    marketRegime: "RANGING" as const,
    adx14: 18,
    atr14: 500,
    avgVolume1m: 100,
    rsi15m: 35,
    imbalance_ratio: 0.5,
    candles5: [],
  };
  const hit = evaluateFastMathBounceEntry(snap);
  assertEquals(hit?.strategy_reason, "strategy_oversold_bounce_entry");
});
