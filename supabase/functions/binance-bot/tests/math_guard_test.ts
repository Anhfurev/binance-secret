// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import {
  buildMathGuardSkipLog,
  evaluateMathGuard,
  isSnapshotMathPrimedForLlm,
} from "../math-guard.ts";
import type { IndicatorSnapshot } from "../types.ts";

function baseSnap(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    symbol: "BTCUSDT",
    latestPrice: 100,
    rsi: 50,
    rsi15m: 50,
    emaFast: 101,
    emaSlow: 99,
    ema50: 100,
    ema200: 95,
    bbLower: 98,
    bbUpper: 102,
    atr14: 1,
    adx14: 25,
    marketRegime: "TRENDING",
    avgVolume1m: 1000,
    volume24hQuote: 1_000_000,
    imbalance_ratio: 0.5,
    macd: { macd: 0.5, signal: 0.2, histogram: 0.3 },
    dayLow24h: 90,
    candles5: [
      { open: 99, high: 100, low: 98, close: 99, volume: 900 },
      { open: 99, high: 101, low: 99, close: 100, volume: 950 },
      { open: 100, high: 102, low: 99, close: 101, volume: 1200 },
    ],
    ...overrides,
  } as IndicatorSnapshot;
}

Deno.test("math guard tier1 blocks RSI above oversold max", () => {
  const snap = baseSnap({ rsi: 42 });
  const entry = { signal: "BUY" as const, strategy_reason: "freqtrade_bbrsi_entry_confirmed" };
  const g = evaluateMathGuard({
    symbol: "BTCUSDT",
    snapshot: snap,
    openTrade: false,
    strategyEntry: entry,
    strategyExitTriggered: false,
    technicalScore: 8,
    minTechScore: 6,
    aggressiveModeEnabled: false,
    isSandboxMode: true,
  });
  assertEquals(g.allowLlm, false);
  assertEquals(g.passLog, null);
  assertEquals(String(g.skipLog ?? "").includes("RSI_NOT_OVERSOLD"), true);
});

Deno.test("math guard tier1 pass log on oversold BUY", () => {
  const snap = baseSnap({ rsi: 28, latestPrice: 97, bbLower: 98 });
  const entry = { signal: "BUY" as const, strategy_reason: "freqtrade_bbrsi_entry_confirmed" };
  const g = evaluateMathGuard({
    symbol: "PEPEUSDT",
    snapshot: snap,
    openTrade: false,
    strategyEntry: entry,
    strategyExitTriggered: false,
    technicalScore: 8,
    minTechScore: 6,
    aggressiveModeEnabled: false,
    isSandboxMode: true,
  });
  assertEquals(g.allowLlm, true);
  assertEquals(
    g.passLog,
    "[OVERSOLD_BOUNCE] Passed math check for PEPEUSDT | RSI: 28.0",
  );
});

Deno.test("math guard blocks flat book when strategy is HOLD", () => {
  const snap = baseSnap({ rsi: 32 });
  const entry = { signal: "HOLD" as const, strategy_reason: "strategy_no_entry_signal", strategy_fail_detail: "RSI_NOT_OVERSOLD" };
  const g = evaluateMathGuard({
    symbol: "BTCUSDT",
    snapshot: snap,
    openTrade: false,
    strategyEntry: entry,
    strategyExitTriggered: false,
    technicalScore: 5,
    minTechScore: 6,
    aggressiveModeEnabled: false,
  });
  assertEquals(g.allowLlm, false);
  assertEquals(
    g.skipLog,
    buildMathGuardSkipLog("BTCUSDT", "RSI_NOT_OVERSOLD"),
  );
});

Deno.test("math guard allows strategy BUY with sufficient tech score", () => {
  const snap = baseSnap({ rsi: 28, latestPrice: 97, bbLower: 98 });
  const entry = { signal: "BUY" as const, strategy_reason: "freqtrade_bbrsi_entry_confirmed" };
  const g = evaluateMathGuard({
    symbol: "PEPEUSDT",
    snapshot: snap,
    openTrade: false,
    strategyEntry: entry,
    strategyExitTriggered: false,
    technicalScore: 8,
    minTechScore: 6,
    aggressiveModeEnabled: false,
    isSandboxMode: true,
  });
  assertEquals(g.allowLlm, true);
});

Deno.test("math guard allows open trade when exit math triggered", () => {
  const g = evaluateMathGuard({
    symbol: "SOLUSDT",
    snapshot: baseSnap(),
    openTrade: true,
    strategyEntry: { signal: "HOLD", strategy_reason: "hold" },
    strategyExitTriggered: true,
    technicalScore: 2,
    minTechScore: 8,
    aggressiveModeEnabled: false,
  });
  assertEquals(g.allowLlm, true);
});

Deno.test("isSnapshotMathPrimedForLlm mirrors entry BUY + tech floor", () => {
  const oversold = baseSnap({ rsi: 28, latestPrice: 97, bbLower: 98 });
  assertEquals(isSnapshotMathPrimedForLlm(oversold), true);
  assertEquals(
    isSnapshotMathPrimedForLlm(baseSnap({
      rsi: 72,
      latestPrice: 80,
      emaFast: 98,
      emaSlow: 101,
      ema50: 105,
      ema200: 110,
    })),
    false,
  );
});
