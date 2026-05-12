import { assertEquals } from "jsr:@std/assert";
import {
  readMinStopLossPct,
  resolveHardStopLossFrac,
  resolveStopLossPctFraction,
  resolveTakeProfitPctPoints,
} from "../trade-stop-risk.ts";

Deno.test("btc floor stop at 1%", () => {
  assertEquals(readMinStopLossPct("BTCUSDT"), 1.0);
  assertEquals(resolveStopLossPctFraction(0.45, "BTCUSDT"), 0.01);
});

Deno.test("sol floor stop at 1.5%", () => {
  assertEquals(readMinStopLossPct("SOLUSDT"), 1.5);
  assertEquals(resolveStopLossPctFraction(0.45, "SOLUSDT"), 0.015);
});

Deno.test("meme floor stop at 3.5%", () => {
  assertEquals(readMinStopLossPct("PEPEUSDT"), 3.5);
  assertEquals(resolveStopLossPctFraction(0.45, "PEPEUSDT"), 0.035);
});

Deno.test("take profit lifts to 2x stop", () => {
  assertEquals(resolveTakeProfitPctPoints(1.5, 2.0, "BTCUSDT"), 4.0);
  assertEquals(resolveTakeProfitPctPoints(4.0, 2.0, "BTCUSDT"), 4.0);
});

Deno.test("hard stop frac follows stored stopLoss price", () => {
  const frac = resolveHardStopLossFrac(
    { entryPrice: 100, stopLoss: 98.0 } as any,
    100,
    0.0045,
  );
  assertEquals(Number(frac.toFixed(4)), 0.02);
});
