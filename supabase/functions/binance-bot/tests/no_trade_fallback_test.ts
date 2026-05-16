import { assertEquals } from "jsr:@std/assert";
import { computeNoTradeFallbackFloors, evaluateNoTradeStrategyScoutBuy } from "../no-trade-fallback.ts";

Deno.test("computeNoTradeFallbackFloors lowers floors within documented bounds", () => {
  const floors = computeNoTradeFallbackFloors(72, 6);
  assertEquals(floors.adjustedMinAiConfidence, 62);
  assertEquals(floors.adjustedMinTechScore, 4);
});

Deno.test("computeNoTradeFallbackFloors never drops below hard minimums", () => {
  const floors = computeNoTradeFallbackFloors(58, 3);
  assertEquals(floors.adjustedMinAiConfidence, 55);
  assertEquals(floors.adjustedMinTechScore, 3);
});

Deno.test("evaluateNoTradeStrategyScoutBuy allows soft chop when paperChopRelaxed", () => {
  const scout = evaluateNoTradeStrategyScoutBuy({
    active: true,
    hasOpenTrade: false,
    strategySignal: "HOLD",
    technical: "BUY",
    technicalScore: 6,
    minTechnicalScore: 5,
    minAiConfidence: 58,
    marketRegime: "RANGING",
    rsi: 48,
    latestPrice: 102,
    bbLower: 100,
    ai: {
      ai_confidence: 62,
      trend: "bullish",
      trend_alignment: true,
      action: "HOLD",
    },
    paperChopRelaxed: true,
  });
  assertEquals(scout?.decision, "BUY");
});

Deno.test("evaluateNoTradeStrategyScoutBuy allows aligned scout entries", () => {
  const scout = evaluateNoTradeStrategyScoutBuy({
    active: true,
    hasOpenTrade: false,
    strategySignal: "HOLD",
    technical: "BUY",
    technicalScore: 6,
    minTechnicalScore: 5,
    minAiConfidence: 58,
    marketRegime: "TRENDING",
    rsi: 48,
    latestPrice: 100,
    bbLower: 98,
    ai: {
      ai_confidence: 62,
      trend: "bullish",
      trend_alignment: true,
      action: "HOLD",
    },
  });
  assertEquals(scout?.decision, "BUY");
  assertEquals(scout?.reason, "no_trade_strategy_scout_buy");
});
