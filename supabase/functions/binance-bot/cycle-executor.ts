// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { processBot } from "./bot.ts";
import { logDecisionTrace, logExecutionOutcome } from "./index-logging.ts";
import { maybeSendDecisionTraceTelegram } from "./telegram-decision-trace.ts";
import { safeExecute, safeExecuteDetached } from "./safe-execute.ts";
import { toStringValue } from "./utils.ts";
import { captureTraceReasonOnly } from "./symbol-cycle-trace.ts";
import {
  persistPostExecutionCycleLogs,
  persistPreExecutionCycleTelemetry,
} from "./cycle-telemetry-persist.ts";
import { indicatorFieldsForLogMeta } from "./indicator-precision.ts";

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
    decision,
    reason,
    technicalScore,
    strategySignal,
    technical,
    minAiConfidence,
    effectiveStrategyExit,
    combinedStrategyReason,
    executionUsdScale,
    demoProbeBuyFlag,
    strategyEntry,
    openTrade,
    preflight,
    aiQuotaFallback,
    aiVerdictErrorDetail,
    grinderTakeProfitPct,
    strategyFailDetail,
    forceBuyReason,
    bbPosition,
    dbLoadOpenTradeMs,
    aiVerdictMs,
    vetoDetailsPayload,
  } = outcome;

  const telegramTraceBase = {
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
  };

  await persistPreExecutionCycleTelemetry({
    supabase,
    row,
    userId,
    symbol,
    cycleId,
    snapshot,
    outcome: {
      ai,
      bbPosition,
      decision,
      reason,
      strategyFailDetail,
      technicalScore,
      strategySignal,
      technical,
      minAiConfidence,
      openTrade,
      dbLoadOpenTradeMs,
      aiVerdictMs,
      vetoDetailsPayload,
      forceBuyReason,
    },
  });
  safeExecuteDetached(
    "decision_trace_telegram_pre",
    () => maybeSendDecisionTraceTelegram({
      ...telegramTraceBase,
      reason: reason ?? null,
    }),
    undefined,
  );

  if (paperScenario && !paperScenario.execute) {
    const dryReason = `${reason ?? "n/a"}|paper_scenario_dry_run`;
    await Promise.all([
      logDecisionTrace({
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
        reason: dryReason,
        minAiConfidence,
      }),
      logExecutionOutcome({
        supabase,
        row,
        symbol,
        intendedDecision: decision,
        reason: dryReason,
        resultAction: "hold",
        resultDetail: "paper_scenario_dry_run_no_execute",
        exitReason: undefined,
      }),
    ]);
    safeExecuteDetached(
      "decision_trace_telegram_dry_run",
      () => maybeSendDecisionTraceTelegram({ ...telegramTraceBase, reason: dryReason, force: true }),
      undefined,
    );
    return {
      tag: "ok" as const,
      result: {
        userId,
        symbol,
        decision,
        action: "hold",
        detail: `paper_scenario_dry_run ${paperScenario.name} decision=${decision}`,
        reason: reason ?? null,
      },
      symbol,
      lastPrice: snapshot.latestPrice,
    };
  }

  if (demoProbeBuyFlag && decision === "BUY") {
    void safeExecute("demo_paper_probe_activated_log", () => supabase.from("logs").insert([{
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
    matrixBuyReason: decision === "BUY" ? (reason ?? null) : null,
    fastBounceLane: Boolean((outcome as { fastBounceLane?: boolean }).fastBounceLane),
    globalSettings: (outcome as { globalSettings?: import("./bot-global-settings.ts").BotGlobalSettingsRow | null }).globalSettings ?? null,
  });

  await persistPostExecutionCycleLogs({
    supabase,
    row,
    symbol,
    technicalScore,
    strategySignal: strategyEntry.signal,
    ai,
    reason,
    decision,
    minAiConfidence,
    marketRegime: String(snapshot.marketRegime ?? "NEUTRAL"),
    resultAction: (result as any)?.action,
    resultDetail: (result as any)?.detail,
    exitReason: (result as any)?.exit_reason,
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
  const indicatorMeta = indicatorFieldsForLogMeta(snapshot, [
    "latestPrice",
    "emaFast",
    "emaSlow",
    "ema200",
  ]);
  await Promise.all([
    captureTraceReasonOnly({
      supabase,
      userId,
      botId: toStringValue((row as any)?.id) ?? null,
      cycleId,
      symbol,
      decision: "HOLD",
      reason,
      perfMetadata: { is_timeout: false },
    }),
    supabase.from("logs").insert([{
      user_id: userId,
      symbol,
      level: "error",
      source: "market-data",
      message: reason === "CRITICAL_PRICE_ZERO" ? "critical_price_zero" : "critical_indicator_invalid",
      meta: reason === "CRITICAL_PRICE_ZERO"
        ? {
          event: "critical_price_zero",
          symbol,
          latest_price: indicatorMeta.latestPrice,
          action: "execution_stopped",
        }
        : {
          event: "critical_indicator_invalid",
          symbol,
          emaFast: indicatorMeta.emaFast,
          emaSlow: indicatorMeta.emaSlow,
          ema200: indicatorMeta.ema200,
          action: "execution_stopped",
        },
      created_at: new Date().toISOString(),
    }]),
  ]);
}
