// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import {
  evaluateBuyLlmPreflightBlock,
  resolveHasOpenPositionFromOpenTrade,
  resolvePositionSupervisorExitHint,
  resolvePositionSupervisorStrategySignal,
  resolveSupervisorOpenTrade,
  shouldUsePrefetchedBuyAiVerdict,
} from "../cycle-decider-pipeline.ts";

Deno.test("buy preflight blocks FAIL_STRATEGY and FAIL_* vetoes", () => {
  const block = evaluateBuyLlmPreflightBlock({
    symbol: "PEPEUSDT",
    hasOpenPosition: false,
    strategyEntry: { signal: "HOLD", strategy_fail_detail: "RSI_NOT_OVERSOLD" },
    strategyFailDetail: "FAIL_STRATEGY:RSI_NOT_OVERSOLD",
    preflightVetoReasons: ["FAIL_STRATEGY_NO_BUY", "FAIL_RSI"],
  });
  assertEquals(block.blocked, true);
  assertEquals(block.detail.includes("FAIL_STRATEGY"), true);
});

Deno.test("open position skips buy preflight block", () => {
  const block = evaluateBuyLlmPreflightBlock({
    symbol: "SOLUSDT",
    hasOpenPosition: true,
    strategyEntry: { signal: "HOLD" },
    strategyFailDetail: null,
    preflightVetoReasons: [],
  });
  assertEquals(block.blocked, false);
});

Deno.test("supervisor signal is SELL only when exit triggered", () => {
  assertEquals(resolvePositionSupervisorStrategySignal({ shouldExit: true }), "SELL");
  assertEquals(resolvePositionSupervisorStrategySignal({ shouldExit: false }), "HOLD");
});

Deno.test("hasOpenPosition stays true after partial TP row update", () => {
  const leg = {
    status: "open",
    amount: 0.25,
    entryPrice: 100,
    stopLoss: 95,
    extra: { partial_tp_executed: true, break_even_after_partial_tp: true },
  };
  assertEquals(resolveHasOpenPositionFromOpenTrade(leg), true);
  assertEquals(resolveSupervisorOpenTrade(leg)?.amount, 0.25);
  assertEquals(resolvePositionSupervisorExitHint(leg, 105), "partial_leg_manage");
});

Deno.test("zero remaining base routes flat (no supervisor)", () => {
  const dust = { status: "open", amount: 0 };
  assertEquals(resolveHasOpenPositionFromOpenTrade(dust), false);
  assertEquals(resolveSupervisorOpenTrade(dust), null);
});

Deno.test("SELL supervisor signal does not imply flat book", () => {
  const leg = { status: "open", amount: 1, entryPrice: 100, stopLoss: 95, extra: {} };
  assertEquals(resolvePositionSupervisorStrategySignal({ shouldExit: true }), "SELL");
  assertEquals(resolveHasOpenPositionFromOpenTrade(leg), true);
});

Deno.test("prefetched AI rejected when buy preflight blocked", () => {
  const blocked = evaluateBuyLlmPreflightBlock({
    symbol: "BTCUSDT",
    hasOpenPosition: false,
    strategyEntry: { signal: "HOLD", strategy_fail_detail: "NO_BUY" },
    strategyFailDetail: "FAIL_STRATEGY:NO_BUY",
    preflightVetoReasons: ["FAIL_STRATEGY_NO_BUY"],
  });
  assertEquals(
    shouldUsePrefetchedBuyAiVerdict(
      { ai: { ai_confidence: 80 }, aiQuotaFallback: false },
      false,
      blocked,
    ),
    false,
  );
});
