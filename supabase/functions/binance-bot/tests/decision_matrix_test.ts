import { assertEquals } from "jsr:@std/assert";
import { decideHybridMatrix } from "../index-decision.ts";

const baseAi = {
  ai_confidence: 82,
  trend: "bullish" as const,
  trend_alignment: true,
  action: "HOLD" as const,
  groq_verdict: "APPROVE" as const,
};

Deno.test("strategy BUY with high-confidence AI HOLD confirms buy", () => {
  const result = decideHybridMatrix({
    strategySignal: "BUY",
    hasOpenTrade: false,
    strategyExitTriggered: false,
    aggressiveModeEnabled: false,
    technical: "BUY",
    technicalScore: 6,
    rsi: 48,
    imbalanceRatio: 1.1,
    marketRegime: "TRENDING",
    latestPrice: 100,
    bbLower: 98,
    isBreakout: false,
    isBelowEma200: false,
    ai: baseAi,
    minAiConfidence: 78,
    minTechnicalScore: 5,
    symbol: "BTCUSDT",
  });
  assertEquals(result.decision, "BUY");
  assertEquals(result.reason, "strategy_confirmed_high_conviction_buy");
});

Deno.test("strategy BUY with low-confidence AI HOLD stays hold", () => {
  const result = decideHybridMatrix({
    strategySignal: "BUY",
    hasOpenTrade: false,
    strategyExitTriggered: false,
    aggressiveModeEnabled: false,
    technical: "BUY",
    technicalScore: 8,
    rsi: 48,
    imbalanceRatio: 1.1,
    marketRegime: "TRENDING",
    latestPrice: 100,
    bbLower: 98,
    isBreakout: false,
    isBelowEma200: false,
    ai: { ...baseAi, ai_confidence: 60 },
    minAiConfidence: 78,
    minTechnicalScore: 5,
    symbol: "BTCUSDT",
  });
  assertEquals(result.decision, "HOLD");
  assertEquals(result.reason, "strategy_buy_rejected_low_conviction");
});

Deno.test("aggressive fallback confirms buy on aligned AI HOLD", () => {
  const result = decideHybridMatrix({
    strategySignal: "HOLD",
    hasOpenTrade: false,
    strategyExitTriggered: false,
    aggressiveModeEnabled: true,
    technical: "HOLD",
    technicalScore: 5,
    rsi: 52,
    imbalanceRatio: 0.6,
    marketRegime: "TRENDING",
    latestPrice: 100,
    bbLower: 98,
    isBreakout: false,
    isBelowEma200: true,
    ai: { ...baseAi, ai_confidence: 52, action: "HOLD" },
    minAiConfidence: 55,
    minTechnicalScore: 5,
    symbol: "SOLUSDT",
  });
  assertEquals(result.decision, "BUY");
  assertEquals(result.reason, "aggressive_buy_confirmed_fallback");
});

Deno.test("tie-breaker accepts technical score above 8", () => {
  const result = decideHybridMatrix({
    strategySignal: "BUY",
    hasOpenTrade: false,
    strategyExitTriggered: false,
    aggressiveModeEnabled: false,
    technical: "HOLD",
    technicalScore: 9,
    rsi: 48,
    imbalanceRatio: 1.1,
    marketRegime: "TRENDING",
    latestPrice: 100,
    bbLower: 98,
    isBreakout: false,
    isBelowEma200: false,
    ai: { ...baseAi, action: "BUY" },
    minAiConfidence: 78,
    minTechnicalScore: 5,
    symbol: "BTCUSDT",
  });
  assertEquals(result.decision, "BUY");
  assertEquals(result.reason, "tie_breaker_quality_buy");
});
