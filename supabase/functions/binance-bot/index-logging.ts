// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import type { AiAnalysis, BotSettingsRow, IndicatorSnapshot, SignalDecision } from "./types.ts";
import {
  resolveMinAiConfidenceForRegime,
  resolveMinTechScore,
  toStringValue,
} from "./utils.ts";
import { formatCycleReason } from "./index-decision-format.ts";
import { resolveStrategyBuyRsiMax } from "./config.ts";
import {
  shouldPersistDecisionAuditLogs,
  shouldPersistExecutionOutcomeLog,
} from "./log-policy.ts";

const DECISION_REASON_MAP: Record<string, string> = {
  hold_low_conf: "AI Confidence too low",
  hold_no_align: "1m and 15m trends are not aligned",
  hold_low_score: "Technical score below configured min_tech_score",
  hold_ai_confidence_too_low: "AI Confidence too low",
  hold_ai_trend_not_aligned: "1m and 15m trends are not aligned",
  hold_technical_score_gate: "Technical score below configured min_tech_score",
  hold_regime_mismatch: "Regime filter blocked BUY",
  ai_high_confidence_override: "AI high-confidence override",
  hold_ema200_gate: "Strict EMA200 gate blocked BUY",
  hold_technical_bearish_override: "Skipped: Technical Bearish Override",
};

export function buildNoStrategyBuyReason(snapshot: IndicatorSnapshot, technicalScore: number) {
  const signals: string[] = [];
  if (Number.isFinite(snapshot.latestPrice) && Number.isFinite(snapshot.emaSlow)) {
    if (snapshot.latestPrice < snapshot.emaSlow) {
      signals.push("Price is below EMA");
    }
  }
  const last5mVolume = snapshot.candles5.at(-1)?.volume;
  if (
    Number.isFinite(last5mVolume) &&
    Number.isFinite(snapshot.avgVolume1m) &&
    snapshot.avgVolume1m > 0 &&
    Number(last5mVolume) < snapshot.avgVolume1m
  ) {
    signals.push("Volume too low");
  }
  const reasonTail = signals.length > 0
    ? signals.join(" or ")
    : "Entry conditions not strong enough";
  return `Strategy: ${reasonTail} for Tech Score ${Math.round(technicalScore)}`;
}

function normalizeDecision(value: unknown): SignalDecision {
  const next = String(value ?? "").toUpperCase();
  if (next === "BUY" || next === "SELL" || next === "HOLD") return next as SignalDecision;
  return "HOLD";
}

export async function logDecisionTrace(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  symbol: string;
  snapshot: IndicatorSnapshot;
  technicalScore: number;
  strategySignal: SignalDecision;
  technicalSignal: SignalDecision;
  ai: AiAnalysis;
  hasOpenTrade: boolean;
  finalDecision: SignalDecision;
  reason?: string;
  /** When omitted, derived from `row` + `snapshot.marketRegime` (same as index). */
  minAiConfidence?: number;
}) {
  const {
    supabase, row, symbol, snapshot, technicalScore, strategySignal, technicalSignal,
    ai, hasOpenTrade, finalDecision, reason, minAiConfidence: minAiParam,
  } = params;
  const minAiConfidence = minAiParam ??
    resolveMinAiConfidenceForRegime(
      row as Record<string, unknown>,
      String(snapshot.marketRegime ?? "NEUTRAL"),
    );
  // Explicitly map from the decision argument and force HOLD fallback so
  // Supabase never receives null/undefined for meta.final_decision.
  const decisionFromArg = finalDecision;
  const safeFinalDecision = normalizeDecision(decisionFromArg);
  const userId = toStringValue((row as any)?.user_id);
  const baseReason = reason === "hold_no_strategy_buy"
    ? buildNoStrategyBuyReason(snapshot, technicalScore)
    : reason === "strategy_buy_rejected_low_confidence"
    ? `Strategy BUY rejected: AI confidence below ${minAiConfidence}`
    : DECISION_REASON_MAP[reason ?? ""] ?? reason ?? "no_reason";
  const mappedReason = safeFinalDecision === "BUY" && snapshot.imbalance_ratio > 2.5
    ? `${baseReason} (Order Book Imbalance Boost)`
    : baseReason;
  if (!shouldPersistDecisionAuditLogs()) return;
  const result = await supabase.from("logs").insert([{
    user_id: userId ?? null,
    symbol,
    level: "info",
    source: "decision-trace",
    message: `decision_${safeFinalDecision.toLowerCase()}`,
    meta: {
      final_decision: safeFinalDecision,
      technical_score: technicalScore,
      strategy_signal: strategySignal,
      technical_signal: technicalSignal,
      ai_action: ai.action,
      ai_confidence: ai.ai_confidence,
      ai_trend_alignment: ai.trend_alignment,
      ai_trend: ai.trend,
      ai_provider: (ai as any)?.ai_provider ?? "unknown",
      ai_provider_path: (ai as any)?.ai_provider_path ?? "n/a",
      ai_cache_status: (ai as any)?.ai_cache_status ?? "unknown",
      imbalance_ratio: snapshot.imbalance_ratio,
      has_open_trade: hasOpenTrade,
      reason: mappedReason,
    },
    created_at: new Date().toISOString(),
  }]);
  if (result.error) {
    console.warn(`[binance-bot] decision trace log skipped: ${result.error.message}`);
  }
}

export async function logCycleSummary(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  symbol: string;
  technicalScore: number;
  strategySignal: SignalDecision;
  ai: AiAnalysis;
  reason?: string;
  finalDecision: SignalDecision;
  minAiConfidence?: number;
  /** Used when `minAiConfidence` is omitted (e.g. error path without snapshot). */
  marketRegime?: string;
}) {
  const {
    supabase, row, symbol, technicalScore, strategySignal, ai, reason, finalDecision,
    minAiConfidence: minAiParam,
    marketRegime,
  } = params;
  const userId = toStringValue((row as any)?.user_id);
  const minAiConfidence = minAiParam ??
    resolveMinAiConfidenceForRegime(
      row as Record<string, unknown>,
      String(marketRegime ?? "NEUTRAL"),
    );
  const minTech = resolveMinTechScore(row as Record<string, unknown>);
  const formattedReason = formatCycleReason(
    reason,
    ai,
    finalDecision,
    minAiConfidence,
    minTech,
    resolveStrategyBuyRsiMax(row),
  );
  const aiProvider = String((ai as any)?.ai_provider ?? "unknown");
  const aiProviderPath = String((ai as any)?.ai_provider_path ?? "n/a");
  const aiCacheStatus = String((ai as any)?.ai_cache_status ?? "unknown");
  const summaryMessage =
    `[Cycle Summary] Symbol: ${symbol} | provider=${aiProvider} | path=${aiProviderPath} | cache=${aiCacheStatus} | final=${finalDecision} | TechScore: ${technicalScore}/10 | Strategy: ${strategySignal} | AI Action: ${ai.action} | Reason: ${formattedReason}`;
  console.log(
    `[AI FLOW] symbol=${symbol} provider=${aiProvider} path=${aiProviderPath} cache=${aiCacheStatus} final=${finalDecision}`,
  );
  if (!shouldPersistDecisionAuditLogs()) return;
  const result = await supabase.from("logs").insert([{
    user_id: userId ?? null,
    symbol,
    level: "info",
    source: "cycle-summary",
    message: summaryMessage,
    meta: {
      technical_score: technicalScore,
      strategy_signal: strategySignal,
      ai_action: ai.action,
      ai_confidence: ai.ai_confidence,
      ai_trend_alignment: ai.trend_alignment,
      ai_provider: aiProvider,
      ai_provider_path: aiProviderPath,
      ai_cache_status: aiCacheStatus,
      final_decision: finalDecision,
      reason: formattedReason,
    },
    created_at: new Date().toISOString(),
  }]);
  if (result.error) {
    console.warn(`[binance-bot] cycle summary log skipped: ${result.error.message}`);
  }
}

export async function logExecutionOutcome(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  symbol: string;
  intendedDecision: SignalDecision;
  reason?: string;
  resultAction?: string;
  resultDetail?: string;
  exitReason?: string;
}) {
  const {
    supabase,
    row,
    symbol,
    intendedDecision,
    reason,
    resultAction,
    resultDetail,
    exitReason,
  } = params;
  const userId = toStringValue((row as any)?.user_id);
  const action = String(resultAction ?? "unknown");
  if (!shouldPersistExecutionOutcomeLog()) return;
  const result = await supabase.from("logs").insert([{
    user_id: userId ?? null,
    symbol,
    level: "info",
    source: "execution-outcome",
    message: `execution_${action}`,
    meta: {
      intended_decision: intendedDecision,
      reason: reason ?? "no_reason",
      action,
      detail: resultDetail ?? null,
      exit_reason: exitReason ?? null,
      matched_intent:
        (intendedDecision === "BUY" && action === "buy") ||
        (intendedDecision === "SELL" && action === "sell") ||
        (intendedDecision === "HOLD" && (action === "hold" || action === "skip")),
    },
    created_at: new Date().toISOString(),
  }]);
  if (result.error) {
    console.warn(`[binance-bot] execution outcome log skipped: ${result.error.message}`);
  }
}
