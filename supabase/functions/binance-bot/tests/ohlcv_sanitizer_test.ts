import { assertEquals } from "jsr:@std/assert";
import { sanitizeOhlcvCandles } from "../ohlcv-sanitizer.ts";

Deno.test("sanitizeOhlcvCandles carries forward invalid prices from prior close", () => {
  const candles = sanitizeOhlcvCandles([
    [1_000, 100, 101, 99, 100, 10],
    [61_000, 0, 0, 0, 0, 5],
  ]);
  assertEquals(candles.length, 2);
  assertEquals(candles[1].close, 100);
  assertEquals(candles[1].open, 100);
});
