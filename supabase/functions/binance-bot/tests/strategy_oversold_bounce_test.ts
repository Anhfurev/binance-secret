// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import { checkEntryConditions } from "../strategy-entry-conditions.ts";
import {
  isDeepOversoldRsi,
  qualifiesOversoldBounceAiSoftOverride,
  resolveMinTechForOversoldBounce,
} from "../strategy-oversold-bounce.ts";
import { decideHybridMatrix } from "../index-decision.ts";
import type { AiAnalysis, IndicatorSnapshot } from "../types.ts";

function baseSnap(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    symbol: "SOLUSDT",
    latestPrice: 98,
    rsi: 32,
    rsi15m: 40,
    emaFast: 99,
    emaSlow: 101,
    ema50: 100,
    ema200: 105,
    bbLower: 99,
    bbUpper: 110,
    macd: { macd: -1, signal: 0 },
    marketRegime: "RANGING",
    adx14: 18,
    atr14: 2,
    imbalance_ratio: 1,
    candles5: [],
    avgVolume1m: 1000,
    dayLow24h: 95,
    ...overrides,
  } as IndicatorSnapshot;
}

Deno.test("deep oversold bounce BUY without fast>slow EMA", () => {
  const snap = baseSnap({
    rsi: 33,
    emaFast: 97,
    emaSlow: 101,
    latestPrice: 98.5,
    bbLower: 99,
  });
  const entry = checkEntryConditions(snap);
  assertEquals(entry.signal, "BUY");
  assertEquals(entry.strategy_reason, "strategy_oversold_bounce_entry");
});

Deno.test("resolveMinTechForOversoldBounce lowers floor when RSI deep oversold", () => {
  assertEquals(resolveMinTechForOversoldBounce(6, { rsi: 33 }, null), 4);
  assertEquals(resolveMinTechForOversoldBounce(6, { rsi: 50 }, null), 6);
});

Deno.test("decideHybridMatrix allows low tech on oversold bounce under EMA200", () => {
  const ai: AiAnalysis = {
    ai_confidence: 72,
    trend: "neutral",
    trend_alignment: true,
    action: "BUY",
    trend_score: 70,
    momentum_score: 70,
    volume_score: 70,
    order_book_score: 70,
    pro_tip: "",
    groq_verdict: "APPROVE",
  };
  const out = decideHybridMatrix({
    strategySignal: "BUY",
    hasOpenTrade: false,
    strategyExitTriggered: false,
    aggressiveModeEnabled: false,
    technical: "HOLD",
    technicalScore: 4,
    rsi: 33,
    imbalanceRatio: 1,
    marketRegime: "RANGING",
    latestPrice: 98,
    bbLower: 99,
    isBreakout: false,
    isBelowEma200: true,
    ai,
    minAiConfidence: 55,
    minTechnicalScore: 4,
    strategyReason: "strategy_oversold_bounce_entry",
    oversoldBounceActive: true,
  });
  assertEquals(out.decision, "BUY");
  assertEquals(out.reason, "oversold_bounce_confirmed_buy");
});

Deno.test("isDeepOversoldRsi default threshold 35", () => {
  assertEquals(isDeepOversoldRsi(34.9), true);
  assertEquals(isDeepOversoldRsi(35), false);
});

Deno.test("decideHybridMatrix oversold bounce overrides soft AI HOLD", () => {
  const ai: AiAnalysis = {
    ai_confidence: 58,
    trend: "bearish",
    trend_alignment: false,
    action: "HOLD",
    trend_score: 40,
    momentum_score: 40,
    volume_score: 50,
    order_book_score: 50,
    pro_tip: "",
    groq_verdict: "APPROVE",
  };
  const out = decideHybridMatrix({
    strategySignal: "BUY",
    hasOpenTrade: false,
    strategyExitTriggered: false,
    aggressiveModeEnabled: false,
    technical: "HOLD",
    technicalScore: 5,
    rsi: 33,
    imbalanceRatio: 1,
    marketRegime: "RANGING",
    latestPrice: 98,
    bbLower: 99,
    isBreakout: false,
    isBelowEma200: true,
    ai,
    minAiConfidence: 60,
    minTechnicalScore: 6,
    strategyReason: "strategy_oversold_bounce_entry",
    oversoldBounceActive: true,
  });
  assertEquals(out.decision, "BUY");
  assertEquals(out.reason, "oversold_bounce_confirmed_buy|bounce_override_ai_soft_hold");
});

Deno.test("decideHybridMatrix oversold bounce rejects high-confidence AI HOLD", () => {
  const ai: AiAnalysis = {
    ai_confidence: 72,
    trend: "bearish",
    trend_alignment: false,
    action: "HOLD",
    trend_score: 40,
    momentum_score: 40,
    volume_score: 50,
    order_book_score: 50,
    pro_tip: "",
    groq_verdict: "APPROVE",
  };
  const out = decideHybridMatrix({
    strategySignal: "BUY",
    hasOpenTrade: false,
    strategyExitTriggered: false,
    aggressiveModeEnabled: false,
    technical: "HOLD",
    technicalScore: 5,
    rsi: 33,
    imbalanceRatio: 1,
    marketRegime: "RANGING",
    latestPrice: 98,
    bbLower: 99,
    isBreakout: false,
    isBelowEma200: true,
    ai,
    minAiConfidence: 60,
    minTechnicalScore: 6,
    strategyReason: "strategy_oversold_bounce_entry",
    oversoldBounceActive: true,
  });
  assertEquals(out.decision, "HOLD");
  assertEquals(out.reason, "hold_ai_action_not_buy");
});

Deno.test("decideHybridMatrix oversold bounce soft SELL override suffix", () => {
  const ai: AiAnalysis = {
    ai_confidence: 52,
    trend: "bearish",
    trend_alignment: false,
    action: "SELL",
    trend_score: 35,
    momentum_score: 35,
    volume_score: 45,
    order_book_score: 45,
    pro_tip: "",
    groq_verdict: "APPROVE",
  };
  assertEquals(
    qualifiesOversoldBounceAiSoftOverride(ai, "strategy_oversold_bounce_entry", true),
    true,
  );
  const out = decideHybridMatrix({
    strategySignal: "BUY",
    hasOpenTrade: false,
    strategyExitTriggered: false,
    aggressiveModeEnabled: false,
    technical: "HOLD",
    technicalScore: 5,
    rsi: 33,
    imbalanceRatio: 1,
    marketRegime: "RANGING",
    latestPrice: 98,
    bbLower: 99,
    isBreakout: false,
    isBelowEma200: true,
    ai,
    minAiConfidence: 60,
    minTechnicalScore: 6,
    strategyReason: "strategy_oversold_bounce_entry",
    oversoldBounceActive: true,
  });
  assertEquals(out.decision, "BUY");
  assertEquals(out.reason, "oversold_bounce_confirmed_buy|bounce_override_ai_soft_sell");
});

Deno.test("decideHybridMatrix regular strategy still requires AI BUY", () => {
  const out = decideHybridMatrix({
    strategySignal: "BUY",
    hasOpenTrade: false,
    strategyExitTriggered: false,
    aggressiveModeEnabled: false,
    technical: "BUY",
    technicalScore: 6,
    rsi: 48,
    imbalanceRatio: 1,
    marketRegime: "TRENDING",
    latestPrice: 100,
    bbLower: 98,
    isBreakout: false,
    isBelowEma200: false,
    ai: {
      ai_confidence: 62,
      trend: "bearish",
      trend_alignment: false,
      action: "HOLD",
      groq_verdict: "APPROVE",
    } as AiAnalysis,
    minAiConfidence: 60,
    minTechnicalScore: 5,
    strategyReason: "strategy_trend_follow_entry",
  });
  assertEquals(out.decision, "HOLD");
  assertEquals(out.reason, "hold_ai_action_not_buy");
});
