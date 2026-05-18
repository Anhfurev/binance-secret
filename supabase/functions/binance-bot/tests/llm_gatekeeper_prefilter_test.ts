// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import {
  evaluateConvictionCeilingBlock,
  evaluateLlmGatekeeperPrefilter,
  PRE_FILTER_POLICY_FLOOR_LOG,
  readLlmBaselineMaxAiUpliftPct,
  readLlmDispatchMinConvictionPct,
  resolveLlmDispatchConvictionFloor,
} from "../llm-gatekeeper-prefilter.ts";
import type { IndicatorSnapshot } from "../types.ts";

function baseSnap(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    symbol: "BTCUSDT",
    latestPrice: 100,
    rsi: 28,
    rsi15m: 28,
    emaFast: 99,
    emaSlow: 98,
    ema50: 97,
    ema200: 95,
    bbLower: 98,
    bbUpper: 102,
    atr14: 1,
    adx14: 25,
    marketRegime: "TRENDING",
    avgVolume1m: 1000,
    volume24hQuote: 5_000_000,
    imbalance_ratio: 1.1,
    macd: { macd: 0.5, signal: 0.2, histogram: 0.3 },
    dayLow24h: 90,
    candles5: [
      { open: 99, high: 100, low: 98, close: 99, volume: 900 },
      { open: 99, high: 101, low: 99, close: 100, volume: 2500 },
      { open: 100, high: 102, low: 99, close: 101, volume: 3200 },
    ],
    ...overrides,
  } as IndicatorSnapshot;
}

Deno.test("gatekeeper phase 1 blocks non-BUY strategy", () => {
  const g = evaluateLlmGatekeeperPrefilter({
    symbol: "BTCUSDT",
    snapshot: baseSnap({ rsi: 28 }),
    openTrade: false,
    strategyEntry: { signal: "HOLD", strategy_fail_detail: "RSI_NOT_OVERSOLD" },
    strategyExitTriggered: false,
    technicalScore: 8,
    minTechScore: 6,
    aggressiveModeEnabled: false,
    isSandboxMode: true,
  });
  assertEquals(g.allowLlm, false);
  assertEquals(g.shortCircuit, true);
  assertEquals(g.phase, 1);
});

Deno.test("gatekeeper open position hold does not force buy LLM", () => {
  const g = evaluateLlmGatekeeperPrefilter({
    symbol: "SOLUSDT",
    snapshot: baseSnap({ rsi: 55, symbol: "SOLUSDT" }),
    openTrade: true,
    strategyEntry: { signal: "HOLD", strategy_reason: "open_position_exit_supervisor" },
    strategyExitTriggered: false,
    technicalScore: 8,
    minTechScore: 6,
    aggressiveModeEnabled: true,
    isSandboxMode: true,
  });
  assertEquals(g.allowLlm, false);
  assertEquals(g.shortCircuit, true);
  assertEquals(g.phase, 1);
});

Deno.test("dispatch conviction floor defaults to 55 and beats low execution_weighted_floor", () => {
  assertEquals(readLlmDispatchMinConvictionPct(), 55);
  const floor = resolveLlmDispatchConvictionFloor({
    botSettingsRow: {},
    marketRegime: "TRENDING",
    tradeRegime: "STABLE",
    cycleMinAiConfidence: 55,
  });
  assertEquals(floor >= 55, true);
});

Deno.test("conviction ceiling blocks 33% tape path before LLM (floor 55)", () => {
  const prevUplift = Deno.env.get("LLM_BASELINE_MAX_AI_UPLIFT_PCT");
  const prevMin = Deno.env.get("LLM_DISPATCH_MIN_CONVICTION_PCT");
  Deno.env.set("LLM_BASELINE_MAX_AI_UPLIFT_PCT", "12");
  Deno.env.set("LLM_DISPATCH_MIN_CONVICTION_PCT", "55");
  try {
    const block = evaluateConvictionCeilingBlock({
      symbol: "BTCUSDT",
      snapshot: baseSnap({
        rsi: 72,
        latestPrice: 80,
        emaFast: 98,
        emaSlow: 101,
        ema50: 105,
        ema200: 110,
        imbalance_ratio: 0.7,
        candles5: [
          { open: 99, high: 100, low: 98, close: 99, volume: 200 },
          { open: 99, high: 101, low: 99, close: 100, volume: 180 },
          { open: 100, high: 102, low: 99, close: 101, volume: 150 },
        ],
      }),
      botSettingsRow: {},
      tradeRegime: "STABLE",
      cycleMinAiConfidence: 55,
    });
    assertEquals(block != null, true);
    assertEquals(block!.allowLlm, false);
    assertEquals(block!.phase, 2);
    assertEquals(String(block!.log ?? "").includes(PRE_FILTER_POLICY_FLOOR_LOG), true);
    assertEquals((block!.baselineWeighted ?? 100) < 55, true);
  } finally {
    if (prevUplift === undefined) Deno.env.delete("LLM_BASELINE_MAX_AI_UPLIFT_PCT");
    else Deno.env.set("LLM_BASELINE_MAX_AI_UPLIFT_PCT", prevUplift);
    if (prevMin === undefined) Deno.env.delete("LLM_DISPATCH_MIN_CONVICTION_PCT");
    else Deno.env.set("LLM_DISPATCH_MIN_CONVICTION_PCT", prevMin);
  }
});
