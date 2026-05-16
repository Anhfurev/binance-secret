// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import { checkEntryConditions } from "../strategy-entry-conditions.ts";
import {
  isDeepOversoldRsi,
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
