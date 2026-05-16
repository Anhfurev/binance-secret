import { assertEquals } from "jsr:@std/assert@1";
import { applyLatestZeroVolumeCarryForward, midPriceFromBidAsk } from "../market-data-helpers.ts";

Deno.test("midPriceFromBidAsk returns spread midpoint", () => {
  assertEquals(midPriceFromBidAsk(100, 101), 100.5);
  assertEquals(midPriceFromBidAsk(0, 101), null);
});

Deno.test("applyLatestZeroVolumeCarryForward patches zero-volume latest bar", () => {
  const patched = applyLatestZeroVolumeCarryForward([
    { openTime: 1, open: 10, high: 10, low: 10, close: 10, volume: 5 },
    { openTime: 2, open: 10, high: 10, low: 10, close: 10, volume: 0 },
  ]);
  assertEquals(patched[1].close, 10);
  assertEquals(patched[1].volume > 0, true);
});
