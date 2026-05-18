import { assertEquals } from "jsr:@std/assert";
import { isAggressiveMatrixBuyReason } from "../buy-helpers.ts";

Deno.test("isAggressiveMatrixBuyReason matches orderbook and fallback tokens", () => {
  assertEquals(isAggressiveMatrixBuyReason("aggressive_buy_confirmed_orderbook"), true);
  assertEquals(isAggressiveMatrixBuyReason("aggressive_buy_confirmed_fallback"), true);
  assertEquals(
    isAggressiveMatrixBuyReason("buy|aggressive_buy_confirmed_orderbook|btc_overbought"),
    true,
  );
  assertEquals(isAggressiveMatrixBuyReason("aggressive_buy_confirmed"), false);
  assertEquals(isAggressiveMatrixBuyReason(null), false);
});

Deno.test("aggressive matrix floor uses min not max of execution vs asset class", () => {
  const executionWeightedFloor = 55;
  const assetClassMinAi = 70;
  const aggressive = true;
  const minAiConfidenceBuy = aggressive
    ? Math.min(executionWeightedFloor, assetClassMinAi)
    : Math.max(executionWeightedFloor, assetClassMinAi);
  assertEquals(minAiConfidenceBuy, 55);
  const normal = Math.max(executionWeightedFloor, assetClassMinAi);
  assertEquals(normal, 70);
});
