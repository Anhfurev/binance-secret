// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { processBot } from "./bot.ts";
import { logCycleSummary, logDecisionTrace, logExecutionOutcome } from "./index-logging.ts";
import { maybeSendDecisionTraceTelegram } from "./telegram-decision-trace.ts";
import { safeExecute } from "./safe-execute.ts";
import { toStringValue } from "./utils.ts";
import { insertWarRoomAudit } from "./veto-transparency.ts";
import { captureTraceReasonOnly, persistDebugTrace } from "./symbol-cycle-trace.ts";

export async function executeSymbolCycleActions(params: {
  row: any;
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  cycleId: string;
  snapshot: any;
  paperScenario?: { name: import("./paper-scenario-snapshot.ts").PaperScenarioName; execute: boolean } | null;
  outcome: Awaited<ReturnType<typeof import("./cycle-decider.ts").decideSymbolCycleOutcome>>;
  signal: AbortSignal;
}) {
  const { row, supabase, userId, symbol, cycleId, snapshot, paperScenario, outcome, signal } = params;
  const {
    ai,
    bbPosition,
    decision,
    reason,
    strategyFailDetail,
    technicalScore,
    strategySignal,
    technical,
    minAiConfidence,
    effectiveStrategyExit,
    combinedStrategyReason,
    executionUsdScale,
    demoProbeBuyFlag,
    strategyEntry,
    forceBuyReason,
    openTrade,
    dbLoadOpenTradeMs,
    aiVerdictMs,
    vetoDetailsPayload,
    preflight,
    aiQuotaFallback,
    aiVerdictErrorDetail,
    grinderTakeProfitPct,
  } = outcome;
  await insertWarRoomAudit({
    supabase,
    user_id: userId !== "unknown" ? userId : null,
    symbol,
    bot_id: toStringValue((row as any).id) ?? null,
    cycle_id: cycleId,
    veto_details: vetoDetailsPayload,
    final_decision: decision,
    technical_score: technicalScore,
    ai_confidence: Number.isFinite(Number(ai.ai_confidence)) ? Number(ai.ai_confidence) : null,
  });
  await persistDebugTrace({
    supabase,
    userId: userId !== "unknown" ? userId : null,
    botId: toStringValue((row as any)?.id) ?? null,
    cycleId,
    symbol,
    decision,
    techScore: technicalScore,
    rsi: snapshot.rsi,
    bbPosition,
    latestPrice: snapshot.latestPrice,
    reason: strategyFailDetail ?? reason ?? null,
    debugNote: forceBuyReason ?? reason,
    perfMetadata: { perf_db_load_open_trade_ms: dbLoadOpenTradeMs, perf_ai_verdict_ms: aiVerdictMs, is_timeout: false },
    ai,
  });
  await logDecisionTrace({
    supabase,
    row,
    symbol,
    snapshot,
    technicalScore,
    strategySignal,
    technicalSignal: technical,
    ai,
    hasOpenTrade: !!openTrade,
    finalDecision: decision,
    reason,
    minAiConfidence,
  });
  void maybeSendDecisionTraceTelegram({
    row,
    symbol,
    cycleId,
    snapshot: {
      marketRegime: snapshot.marketRegime,
      rsi: snapshot.rsi,
      latestPrice: snapshot.latestPrice,
    },
    snapshotFull: snapshot,
    ai,
    finalDecision: decision,
    reason: reason ?? null,
    technicalScore,
    strategySignal,
    technicalSignal: technical,
    hasOpenTrade: !!openTrade,
    minAiConfidence,
    strategyEntry,
    strategyFailDetail,
    combinedStrategyReason,
    preflight: {
      scorecard: preflight.scorecard,
      veto_reasons: preflight.veto_reasons,
      passedCount: preflight.passedCount,
      totalGates: preflight.totalGates,
    },
    aiQuotaFallback,
    aiVerdictErrorDetail: aiVerdictErrorDetail ?? null,
  });
  if (paperScenario && !paperScenario.execute) {
    await logDecisionTrace({
      supabase,
      row,
      symbol,
      snapshot,
      technicalScore,
      strategySignal,
      technicalSignal: technical,
      ai,
      hasOpenTrade: !!openTrade,
      finalDecision: decision,
      reason: `${reason ?? "n/a"}|paper_scenario_dry_run`,
      minAiConfidence,
    });
    void maybeSendDecisionTraceTelegram({
      row,
      symbol,
      cycleId,
      snapshot: {
        marketRegime: snapshot.marketRegime,
        rsi: snapshot.rsi,
        latestPrice: snapshot.latestPrice,
      },
      snapshotFull: snapshot,
      ai,
      finalDecision: decision,
      reason: `${reason ?? "n/a"}|paper_scenario_dry_run`,
      technicalScore,
      strategySignal,
      technicalSignal: technical,
      hasOpenTrade: !!openTrade,
      minAiConfidence,
      strategyEntry,
      strategyFailDetail,
      combinedStrategyReason,
      preflight: {
        scorecard: preflight.scorecard,
        veto_reasons: preflight.veto_reasons,
        passedCount: preflight.passedCount,
        totalGates: preflight.totalGates,
      },
      aiQuotaFallback,
      aiVerdictErrorDetail: aiVerdictErrorDetail ?? null,
      force: true,
    });
    await logExecutionOutcome({
      supabase,
      row,
      symbol,
      intendedDecision: decision,
      reason: `${reason ?? "n/a"}|paper_scenario_dry_run`,
      resultAction: "hold",
      resultDetail: "paper_scenario_dry_run_no_execute",
      exitReason: undefined,
    });
    return {
      tag: "ok" as const,
      result: { userId, symbol, decision, action: "hold", detail: `paper_scenario_dry_run ${paperScenario.name} decision=${decision}`, reason: reason ?? null },
      symbol,
      lastPrice: snapshot.latestPrice,
    };
  }
  if (demoProbeBuyFlag && decision === "BUY") {
    await safeExecute("demo_paper_probe_activated_log", () => supabase.from("logs").insert([{
      user_id: userId,
      symbol,
      level: "info",
      source: "demo-probe-buy",
      message: "demo_paper_probe_activated",
      meta: { event: "demo_paper_probe_activated", paper_only: true },
      created_at: new Date().toISOString(),
    }]), undefined);
  }
  const result = await processBot({
    supabase,
    row,
    snapshot,
    technical,
    ai,
    decision,
    exitReason: effectiveStrategyExit.exit_reason,
    strategyReason: combinedStrategyReason,
    cycleId,
    executionUsdScale,
    signal,
    demoProbeBuy: demoProbeBuyFlag,
    takeProfitPctOverride: grinderTakeProfitPct ?? null,
  });
  await logExecutionOutcome({
    supabase,
    row,
    symbol,
    intendedDecision: decision,
    reason,
    resultAction: (result as any)?.action,
    resultDetail: (result as any)?.detail,
    exitReason: (result as any)?.exit_reason,
  });
  await logCycleSummary({
    supabase,
    row,
    symbol,
    technicalScore,
    strategySignal: strategyEntry.signal,
    ai,
    reason,
    finalDecision: decision,
    minAiConfidence,
    marketRegime: snapshot.marketRegime,
  });
  return { tag: "ok" as const, result, symbol, lastPrice: snapshot.latestPrice };
}

export async function handleCriticalSnapshotError(params: {
  supabase: ReturnType<typeof createClient>;
  row: any;
  cycleId: string;
  symbol: string;
  reason: "CRITICAL_INDICATOR_ZERO" | "CRITICAL_PRICE_ZERO";
  snapshot: any;
}) {
  const { supabase, row, cycleId, symbol, reason, snapshot } = params;
  const userId = toStringValue((row as any)?.user_id) ?? null;
  await captureTraceReasonOnly({ supabase, userId, botId: toStringValue((row as any)?.id) ?? null, cycleId, symbol, decision: "HOLD", reason, perfMetadata: { is_timeout: false } });
  await supabase.from("logs").insert([{
    user_id: userId,
    symbol,
    level: "error",
    source: "market-data",
    message: reason === "CRITICAL_PRICE_ZERO" ? "critical_price_zero" : "critical_indicator_invalid",
    meta: reason === "CRITICAL_PRICE_ZERO"
      ? { event: "critical_price_zero", symbol, latest_price: snapshot.latestPrice, action: "execution_stopped" }
      : { event: "critical_indicator_invalid", symbol, emaFast: snapshot.emaFast, emaSlow: snapshot.emaSlow, ema200: snapshot.ema200, action: "execution_stopped" },
    created_at: new Date().toISOString(),
  }]);
}
