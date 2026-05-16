import { assertEquals } from "jsr:@std/assert";
import {
  classifyHoldNoStrategyDominance,
  classifyRecentErrorIssues,
  classifyStaleCapitalReservationIssue,
  classifySymbolCycleFailureIssue,
  classifyTightTrailingExitIssue,
  collectMissingRequiredEnvIssues,
  readDebuggerErrorSpikeThreshold,
  trailDistancePctFromTrade,
} from "../debugger-issue-rules.ts";

Deno.test("collectMissingRequiredEnvIssues downgrades missing Binance creds when gateway is on", () => {
  Deno.env.set("GEMINI_API_KEY", "debugger-test-gemini-placeholder");
  try {
    const hasEnv = (name: string) => !name.startsWith("BINANCE");
    const issues = collectMissingRequiredEnvIssues(hasEnv, { gatewayEnabled: true });
    assertEquals(issues.length, 1);
    assertEquals(issues[0]?.severity, "warn");
    assertEquals(issues[0]?.code, "MISSING_REQUIRED_ENV");
  } finally {
    Deno.env.delete("GEMINI_API_KEY");
  }
});

Deno.test("classifyRecentErrorIssues escalates actionable spikes", () => {
  Deno.env.delete("DEBUGGER_ERROR_SPIKE_THRESHOLD");
  const critical = classifyRecentErrorIssues({
    errorCount: 55,
    actionableErrorCount: 50,
    resolvedErrorCount: 5,
    breakdown: { symbol_cycle_failed: 50 },
  });
  assertEquals(critical[0]?.code, "ERROR_SPIKE_RECENT");
  const warn = classifyRecentErrorIssues({
    errorCount: 3,
    actionableErrorCount: 2,
    resolvedErrorCount: 1,
    breakdown: { symbol_cycle_failed: 2 },
  });
  assertEquals(warn[0]?.code, "ERRORS_RECENT");
});

Deno.test("classifySymbolCycleFailureIssue escalates repeated failures", () => {
  assertEquals(classifySymbolCycleFailureIssue(0), null);
  assertEquals(classifySymbolCycleFailureIssue(2)?.severity, "warn");
  assertEquals(classifySymbolCycleFailureIssue(6)?.severity, "critical");
});

Deno.test("classifyStaleCapitalReservationIssue escalates large stale lock sets", () => {
  assertEquals(classifyStaleCapitalReservationIssue(0, "2026-01-01T00:00:00.000Z"), null);
  assertEquals(classifyStaleCapitalReservationIssue(3, "2026-01-01T00:00:00.000Z")?.severity, "warn");
  assertEquals(classifyStaleCapitalReservationIssue(10, "2026-01-01T00:00:00.000Z")?.severity, "critical");
});

Deno.test("classifyHoldNoStrategyDominance warns on dominant hold_no_strategy_buy", () => {
  Deno.env.delete("DEBUGGER_HOLD_NO_STRATEGY_WARN_COUNT");
  assertEquals(classifyHoldNoStrategyDominance(27, 40), null);
  assertEquals(classifyHoldNoStrategyDominance(28, 40)?.code, "HOLD_NO_STRATEGY_DOMINANT");
});

Deno.test("trailDistancePctFromTrade reads trail distance and trailing_stop_pct", () => {
  assertEquals(
    trailDistancePctFromTrade(81_000, { trail_distance_price: 40.5 }),
    0.05,
  );
  assertEquals(
    trailDistancePctFromTrade(81_000, { trailing_stop_pct: 1.5 }),
    1.5,
  );
});

Deno.test("classifyTightTrailingExitIssue flags clustered tight paper stops", () => {
  Deno.env.delete("DEBUGGER_TIGHT_TRAIL_MIN_PCT");
  const issue = classifyTightTrailingExitIssue([
    { symbol: "BTCUSDT", entryPrice: 81_000, extra: { trail_distance_price: 40 } },
    { symbol: "BTCUSDT", entryPrice: 81_100, extra: { trail_distance_price: 41 } },
    { symbol: "BTCUSDT", entryPrice: 81_200, extra: { trail_distance_price: 42 } },
  ]);
  assertEquals(issue?.code, "TIGHT_TRAILING_EXITS");
  assertEquals(readDebuggerErrorSpikeThreshold(), 50);
});
