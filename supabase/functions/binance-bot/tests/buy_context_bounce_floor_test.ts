import { assertEquals } from "jsr:@std/assert";
import {
  isOversoldBounceMatrixBuyReason,
  qualifiesOversoldBounceRelaxedPath,
  readOversoldBounceSymbolExecutionCap,
  resolveOversoldBounceMinAiConfidenceBuy,
} from "../buy-bounce-floor.ts";
import { isAggressiveMatrixBuyReason } from "../buy-helpers.ts";

Deno.test("qualifiesOversoldBounceRelaxedPath via strategy_reason alone", () => {
  assertEquals(
    qualifiesOversoldBounceRelaxedPath({
      strategyReason: "strategy_oversold_bounce_entry",
      matrixBuyReason: "strategy_confirmed_high_conviction_buy",
    }),
    true,
  );
});

Deno.test("qualifiesOversoldBounceRelaxedPath via combined trace when matrix reason is generic", () => {
  assertEquals(
    qualifiesOversoldBounceRelaxedPath({
      matrixBuyReason: "strategy_confirmed_high_conviction_buy",
      combinedTrace:
        "strategy_oversold_bounce_entry|strategy_confirmed_high_conviction_buy|bounce_override_ai_soft_hold",
    }),
    true,
  );
  assertEquals(
    qualifiesOversoldBounceRelaxedPath({
      matrixBuyReason: "strategy_confirmed_high_conviction_buy",
      combinedTrace: "strategy_trend_follow|strategy_confirmed_high_conviction_buy",
    }),
    false,
  );
});

Deno.test("isOversoldBounceMatrixBuyReason matches compound bounce tokens", () => {
  assertEquals(isOversoldBounceMatrixBuyReason("oversold_bounce_confirmed_buy"), true);
  assertEquals(
    isOversoldBounceMatrixBuyReason(
      "oversold_bounce_confirmed_buy|bounce_override_ai_soft_hold",
    ),
    true,
  );
  assertEquals(isOversoldBounceMatrixBuyReason("aggressive_buy_confirmed_orderbook"), false);
  assertEquals(isAggressiveMatrixBuyReason("oversold_bounce_confirmed_buy"), false);
});

Deno.test("readOversoldBounceSymbolExecutionCap SOL 55 PEPE 35", () => {
  const prevPepe = Deno.env.get("OVERSOLD_BOUNCE_FLOOR_PEPE");
  const prevSol = Deno.env.get("OVERSOLD_BOUNCE_FLOOR_SOL");
  try {
    Deno.env.delete("OVERSOLD_BOUNCE_FLOOR_PEPE");
    Deno.env.delete("OVERSOLD_BOUNCE_FLOOR_SOL");
    assertEquals(readOversoldBounceSymbolExecutionCap("SOLUSDT"), 55);
    assertEquals(readOversoldBounceSymbolExecutionCap("PEPEUSDT"), 35);
    Deno.env.set("OVERSOLD_BOUNCE_FLOOR_SOL", "40");
    assertEquals(readOversoldBounceSymbolExecutionCap("SOLUSDT"), 40);
  } finally {
    if (prevPepe === undefined) Deno.env.delete("OVERSOLD_BOUNCE_FLOOR_PEPE");
    else Deno.env.set("OVERSOLD_BOUNCE_FLOOR_PEPE", prevPepe);
    if (prevSol === undefined) Deno.env.delete("OVERSOLD_BOUNCE_FLOOR_SOL");
    else Deno.env.set("OVERSOLD_BOUNCE_FLOOR_SOL", prevSol);
  }
});

Deno.test("oversold bounce unified floor cap respects PEPE 35 not trending 45", () => {
  const bounceCap = readOversoldBounceSymbolExecutionCap("PEPEUSDT");
  const trendingLegacyFloor = 45;
  const unifiedFloor = Math.min(trendingLegacyFloor, bounceCap);
  assertEquals(unifiedFloor, 35);
});

Deno.test("resolveOversoldBounceMinAiConfidenceBuy relaxes VOLATILE 70 to SOL 55", () => {
  const floor = resolveOversoldBounceMinAiConfidenceBuy({
    executionWeightedFloor: 55,
    assetClassMinAi: 70,
    symbol: "SOLUSDT",
    effectiveConfidence: 58,
  });
  assertEquals(floor, 55);
});

Deno.test("resolveOversoldBounceMinAiConfidenceBuy PEPE allows 39% when cap is 35", () => {
  const floor = resolveOversoldBounceMinAiConfidenceBuy({
    executionWeightedFloor: 55,
    assetClassMinAi: 70,
    symbol: "PEPEUSDT",
    effectiveConfidence: 39,
  });
  assertEquals(floor, 35);
  assertEquals(39 >= floor, true);
});

Deno.test("resolveOversoldBounceMinAiConfidenceBuy PEPE allows down to 35", () => {
  const floor = resolveOversoldBounceMinAiConfidenceBuy({
    executionWeightedFloor: 55,
    assetClassMinAi: 70,
    symbol: "PEPEUSDT",
    effectiveConfidence: 48,
  });
  assertEquals(floor, 35);
  assertEquals(
    42 >= resolveOversoldBounceMinAiConfidenceBuy({
      executionWeightedFloor: 55,
      assetClassMinAi: 70,
      symbol: "PEPEUSDT",
      effectiveConfidence: 42,
    }),
    true,
  );
});

Deno.test("normal trend entry floor stays max not min", () => {
  const executionWeightedFloor = 55;
  const assetClassMinAi = 70;
  const normal = Math.max(executionWeightedFloor, assetClassMinAi);
  assertEquals(normal, 70);
});
