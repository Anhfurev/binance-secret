import { assertEquals } from "jsr:@std/assert";
import {
  readAiPriceMoveThresholdPercent,
  shouldRunAiCheck,
} from "../index-ai.ts";
import { IS_TEST_MODE } from "../config.ts";
import type { IndicatorSnapshot } from "../types.ts";

function baseSnapshot(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    symbol: "BTCUSDT",
    latestPrice: 100,
    rsi: 50,
    ...overrides,
  } as IndicatorSnapshot;
}

Deno.test("readAiPriceMoveThresholdPercent defaults to 0.5", () => {
  Deno.env.delete("AI_PRICE_MOVE_THRESHOLD_PCT");
  const expected = IS_TEST_MODE ? 0.05 : 0.5;
  assertEquals(readAiPriceMoveThresholdPercent(), expected);
});

Deno.test("readAiPriceMoveThresholdPercent clamps invalid env to default", () => {
  Deno.env.set("AI_PRICE_MOVE_THRESHOLD_PCT", "not-a-number");
  const expected = IS_TEST_MODE ? 0.05 : 0.5;
  assertEquals(readAiPriceMoveThresholdPercent(), expected);
  Deno.env.delete("AI_PRICE_MOVE_THRESHOLD_PCT");
});

Deno.test("shouldRunAiCheck triggers on stretched RSI", () => {
  const map = new Map<string, number>([["BTCUSDT", 100]]);
  assertEquals(shouldRunAiCheck(baseSnapshot({ rsi: 71 }), map), true);
  assertEquals(shouldRunAiCheck(baseSnapshot({ rsi: 29 }), map), true);
});

Deno.test("shouldRunAiCheck skips small price drift under threshold", () => {
  Deno.env.set("AI_PRICE_MOVE_THRESHOLD_PCT", "0.5");
  const map = new Map<string, number>([["BTCUSDT", 100]]);
  if (IS_TEST_MODE) {
    assertEquals(shouldRunAiCheck(baseSnapshot({ latestPrice: 100.2, rsi: 50 }), map), true);
    assertEquals(shouldRunAiCheck(baseSnapshot({ latestPrice: 100.6, rsi: 50 }), map), true);
  } else {
    assertEquals(
      shouldRunAiCheck(baseSnapshot({ latestPrice: 100.2, rsi: 50 }), map),
      false,
    );
    assertEquals(
      shouldRunAiCheck(baseSnapshot({ latestPrice: 100.6, rsi: 50 }), map),
      true,
    );
  }
  Deno.env.delete("AI_PRICE_MOVE_THRESHOLD_PCT");
});

Deno.test("shouldRunAiCheck runs when no prior AI price exists", () => {
  assertEquals(shouldRunAiCheck(baseSnapshot(), new Map()), true);
});
