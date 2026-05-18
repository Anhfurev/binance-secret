// @ts-nocheck
import { assertEquals, assertAlmostEquals } from "jsr:@std/assert";
import {
  ALT_FUTURES_MIN_NOTIONAL_USD,
  BTC_FUTURES_MIN_NOTIONAL_USD,
  computeFastLaneFuturesQty,
  computeFastLaneNotionalUsd,
} from "../futures-lane-sizing.ts";

const GLOBAL_10X = {
  market_regime: "NEUTRAL",
  allowed_leverage: 10,
  global_trade_multiplier: 1,
};

Deno.test("computeFastLaneNotionalUsd baseline 27*0.15*10*1 = 40.5 for alts", () => {
  const n = computeFastLaneNotionalUsd("SOLUSDT", GLOBAL_10X, 27);
  assertEquals(n, 40.5);
});

Deno.test("computeFastLaneNotionalUsd clamps BTC to 51 USDT floor", () => {
  const n = computeFastLaneNotionalUsd("BTCUSDT", GLOBAL_10X, 27);
  assertEquals(n, BTC_FUTURES_MIN_NOTIONAL_USD);
  assertEquals(n, 51);
});

Deno.test("computeFastLaneNotionalUsd clamps alts to 5.5 when formula is tiny", () => {
  const n = computeFastLaneNotionalUsd("PEPEUSDT", {
    ...GLOBAL_10X,
    allowed_leverage: 1,
    global_trade_multiplier: 0.1,
  }, 27);
  assertEquals(n, ALT_FUTURES_MIN_NOTIONAL_USD);
});

Deno.test("computeFastLaneFuturesQty BTC uses 0.001 step and clears 51 notional", () => {
  const notional = computeFastLaneNotionalUsd("BTCUSDT", GLOBAL_10X, 27);
  const px = 90_000;
  const qty = computeFastLaneFuturesQty("BTCUSDT", notional, px);
  assertEquals(qty, 0.001);
  assertAlmostEquals(qty * px, 90, 0.01);
});

Deno.test("computeFastLaneFuturesQty SOL keeps 3dp lot at 40.5 notional", () => {
  const notional = computeFastLaneNotionalUsd("SOLUSDT", GLOBAL_10X, 27);
  const px = 150;
  const qty = computeFastLaneFuturesQty("SOLUSDT", notional, px);
  assertEquals(qty, 0.27);
  assertAlmostEquals(qty * px, 40.5, 0.01);
});

Deno.test("computeFastLaneFuturesQty PEPE uses integer contracts", () => {
  const notional = computeFastLaneNotionalUsd("PEPEUSDT", GLOBAL_10X, 27);
  const px = 0.00001;
  const qty = computeFastLaneFuturesQty("PEPEUSDT", notional, px);
  assertEquals(qty, Math.floor(qty));
  assertAlmostEquals(qty * px, notional, 0.02);
});
