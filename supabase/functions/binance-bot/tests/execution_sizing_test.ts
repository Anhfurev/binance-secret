import { assertEquals } from "jsr:@std/assert";
import { calculateDynamicPositionSize } from "../execution.ts";

Deno.test("calculateDynamicPositionSize caps Kelly fraction at max position size", () => {
  const size = calculateDynamicPositionSize({
    aiConfidence: 95,
    winLossRatio: 2,
    totalBalance: 10_000,
    maxPositionSize: 0.1,
  });
  assertEquals(size, 1000);
});

Deno.test("calculateDynamicPositionSize returns zero when Kelly is negative", () => {
  const size = calculateDynamicPositionSize({
    aiConfidence: 20,
    winLossRatio: 1,
    totalBalance: 10_000,
  });
  assertEquals(size, 0);
});
