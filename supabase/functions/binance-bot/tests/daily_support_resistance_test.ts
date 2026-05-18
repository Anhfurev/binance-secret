// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import { computeDailySupportResistance } from "../daily-support-resistance.ts";
import type { Candle } from "../types.ts";

function dailyBar(close: number, spread = 2): Candle {
  return {
    openTime: 0,
    open: close,
    high: close + spread,
    low: close - spread,
    close,
    volume: 1000,
  };
}

Deno.test("computeDailySupportResistance returns sorted support and resistance", () => {
  const bars: Candle[] = [];
  for (let i = 0; i < 20; i += 1) {
    bars.push(dailyBar(100 + i * 0.5));
  }
  const sr = computeDailySupportResistance(bars);
  assertEquals(sr.support.length >= 2, true);
  assertEquals(sr.resistance.length >= 2, true);
  assertEquals(sr.support[0]! < sr.support[sr.support.length - 1]!, true);
  assertEquals(sr.resistance[0]! < sr.resistance[sr.resistance.length - 1]!, true);
});
