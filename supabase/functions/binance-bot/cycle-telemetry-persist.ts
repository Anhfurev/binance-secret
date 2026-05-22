// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { AiAnalysis, BotSettingsRow, IndicatorSnapshot, SignalDecision } from "./types.ts";
import { fireAndForgetSideEffect } from "./edge-runtime.ts";
import { logCycleSummary, logDecisionTrace, logExecutionOutcome } from "./index-logging.ts";
import { insertWarRoomAudit } from "./veto-transparency.ts";
import { persistDebugTrace } from "./symbol-cycle-trace.ts";
import { toStringValue } from "./utils.ts";

/** Hot path: do not block `processBot` on audit DB writes. */
export function enqueuePreExecutionCycleTelemetry(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  userId: string;
  symbol: string;
  cycleId: string;
  snapshot: IndicatorSnapshot;
  outcome: {
    ai: AiAnalysis;
    bbPosition: number;
    decision: SignalDecision;
    reason?: string;
    strategyFailDetail?: string | null;
    technicalScore: number;
    strategySignal: SignalDecision;
    technical: SignalDecision;
    minAiConfidence: number;
    openTrade: unknown;
    dbLoadOpenTradeMs: number;
    aiVerdictMs: number;
    vetoDetailsPayload: unknown;
    forceBuyReason?: string | null;
  };
}): void {
  fireAndForgetSideEffect(
    "pre_execution_cycle_telemetry",
    () => persistPreExecutionCycleTelemetry(params),
  );
}

export function enqueuePostExecutionCycleLogs(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  symbol: string;
  technicalScore: number;
  strategySignal: SignalDecision;
  ai: AiAnalysis;
  reason?: string;
  decision: SignalDecision;
  minAiConfidence: number;
  marketRegime: string;
  resultAction?: string;
  resultDetail?: string;
  exitReason?: string;
}): void {
  fireAndForgetSideEffect(
    "post_execution_cycle_logs",
    () => persistPostExecutionCycleLogs(params),
  );
}

export async function persistPreExecutionCycleTelemetry(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  userId: string;
  symbol: string;
  cycleId: string;
  snapshot: IndicatorSnapshot;
  outcome: {
    ai: AiAnalysis;
    bbPosition: number;
    decision: SignalDecision;
    reason?: string;
    strategyFailDetail?: string | null;
    technicalScore: number;
    strategySignal: SignalDecision;
    technical: SignalDecision;
    minAiConfidence: number;
    openTrade: unknown;
    dbLoadOpenTradeMs: number;
    aiVerdictMs: number;
    vetoDetailsPayload: unknown;
    forceBuyReason?: string | null;
  };
}): Promise<void> {
  const { supabase, row, userId, symbol, cycleId, snapshot, outcome } = params;
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
    openTrade,
    dbLoadOpenTradeMs,
    aiVerdictMs,
    vetoDetailsPayload,
    forceBuyReason,
  } = outcome;
  await Promise.all([
    insertWarRoomAudit({
      supabase,
      user_id: userId !== "unknown" ? userId : null,
      symbol,
      bot_id: toStringValue((row as any).id) ?? null,
      cycle_id: cycleId,
      veto_details: vetoDetailsPayload,
      final_decision: decision,
      technical_score: technicalScore,
      ai_confidence: Number.isFinite(Number(ai.ai_confidence)) ? Number(ai.ai_confidence) : null,
    }),
    persistDebugTrace({
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
      perfMetadata: {
        perf_db_load_open_trade_ms: dbLoadOpenTradeMs,
        perf_ai_verdict_ms: aiVerdictMs,
        is_timeout: false,
      },
      ai,
    }),
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
      reason,
      minAiConfidence,
    }),
  ]);
}

export async function persistPostExecutionCycleLogs(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  symbol: string;
  technicalScore: number;
  strategySignal: SignalDecision;
  ai: AiAnalysis;
  reason?: string;
  decision: SignalDecision;
  minAiConfidence: number;
  marketRegime: string;
  resultAction?: string;
  resultDetail?: string;
  exitReason?: string;
}): Promise<void> {
  const {
    supabase,
    row,
    symbol,
    technicalScore,
    strategySignal,
    ai,
    reason,
    decision,
    minAiConfidence,
    marketRegime,
    resultAction,
    resultDetail,
    exitReason,
  } = params;
  await Promise.all([
    logExecutionOutcome({
      supabase,
      row,
      symbol,
      intendedDecision: decision,
      reason,
      resultAction,
      resultDetail,
      exitReason,
    }),
    logCycleSummary({
      supabase,
      row,
      symbol,
      technicalScore,
      strategySignal,
      ai,
      reason,
      finalDecision: decision,
      minAiConfidence,
      marketRegime,
    }),
  ]);
}
