import { assertEquals } from "jsr:@std/assert";
import {
  readMemeTrailingPctFloor,
  widenTrailingStopBelowHigh,
} from "../buy-helpers.ts";

Deno.test("meme trailing floor defaults to 1.5% for PEPE", () => {
  Deno.env.delete("MEME_MIN_TRAILING_PCT");
  assertEquals(readMemeTrailingPctFloor("PEPEUSDT"), 0.015);
});

Deno.test("widenTrailingStopBelowHigh widens tight ATR trails on memes", () => {
  const high = 0.0000042;
  const tight = high - 1.7e-8;
  const widened = widenTrailingStopBelowHigh(high, tight, 0.0175, "PEPEUSDT");
  assertEquals(widened < tight, true);
});
