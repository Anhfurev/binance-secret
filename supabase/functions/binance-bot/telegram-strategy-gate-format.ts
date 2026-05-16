// @ts-nocheck
import type { AiAnalysis, BotSettingsRow, EntryCheckResult, IndicatorSnapshot, SignalDecision } from "./types.ts";
import { escapeHtml } from "./bot-shared.ts";
import { resolveStrategyBuyRsiMax } from "./config.ts";
import { formatCycleReason } from "./index-decision-format.ts";
import { buildNoStrategyBuyReason } from "./index-logging.ts";

export type PreflightSnapshot = {
  scorecard: Record<string, boolean>;
  veto_reasons: string[];
  passedCount: number;
  totalGates: number;
};

export function dominantStrategyLabel(
  strategyEntry: EntryCheckResult,
  strategyFailDetail: string | null,
): string {
  if (strategyEntry.signal === "BUY") return String(strategyEntry.strategy_reason ?? "BUY");
  const fromEntry = String(strategyEntry.strategy_fail_detail ?? "").trim();
  if (fromEntry) return fromEntry;
  if (strategyFailDetail?.startsWith("FAIL_STRATEGY:")) {
    return strategyFailDetail.slice("FAIL_STRATEGY:".length);
  }
  return "NO_BUY";
}

export function describeStrategyGateHumanLine(params: {
  reason?: string | null;
  snapshot: IndicatorSnapshot;
  technicalScore: number;
  ai: AiAnalysis;
  finalDecision: SignalDecision;
  minAiConfidence: number;
  minTech: number;
  row: BotSettingsRow;
}): string {
  const rsiBuyMax = resolveStrategyBuyRsiMax(params.row as Record<string, unknown>);
  const r = params.reason ?? undefined;
  if (r === "hold_no_strategy_buy") {
    return buildNoStrategyBuyReason(params.snapshot, params.technicalScore);
  }
  return formatCycleReason(
    r,
    params.ai,
    params.finalDecision,
    params.minAiConfidence,
    params.minTech,
    rsiBuyMax,
  );
}

/** AI path degraded: quota fallback, thrown LLM error (caught by safeExecute), or obvious fallback provider. */
export function formatAiPipelineIssueBannerHtml(params: {
  symbol: string;
  aiQuotaFallback: boolean;
  aiVerdictErrorDetail: string | null;
  ai: AiAnalysis;
}): string | null {
  const prov = String((params.ai as any)?.ai_provider ?? "").toLowerCase();
  const path = String((params.ai as any)?.ai_provider_path ?? "").toLowerCase();
  const err = params.aiVerdictErrorDetail ?? "";
  const showCrash =
    Boolean(params.aiVerdictErrorDetail) ||
    params.aiQuotaFallback ||
    (prov === "fallback" && (path.includes("quota") || path.includes("cooldown")));
  if (!showCrash) return null;
  const hint =
    /token|payload|too large|context length|max_tokens/i.test(err)
      ? " (likely token / payload limit)"
      : "";
  const detail = escapeHtml(
    params.aiVerdictErrorDetail
      ? (err.slice(0, 250) + hint).slice(0, 300)
      : params.aiQuotaFallback
      ? "Quota / cooldown fallback — LLM output may be neutral safety AI."
      : "Fallback provider path active.",
  );
  return (
    `<b>❌ AI PIPELINE</b> ${escapeHtml(params.symbol)}\n` +
    `<b>Status</b>: Blocked or degraded before / during full AI analysis.\n` +
    `<b>Detail</b>: <code>${detail}</code>\n\n`
  );
}

export function formatStrategyGateTelegramSectionHtml(params: {
  symbol: string;
  strategyEntry: EntryCheckResult;
  strategySignal: SignalDecision;
  strategyFailDetail: string | null;
  combinedStrategyReason: string;
  preflight: PreflightSnapshot;
  gateHumanLine: string;
  finalDecision: SignalDecision;
  minAiConfidence: number;
  currentPrice: number | undefined;
}): string {
  const se = params.strategyEntry;
  const dominant = escapeHtml(dominantStrategyLabel(se, params.strategyFailDetail));
  const csr = escapeHtml(String(params.combinedStrategyReason ?? "").slice(0, 420));
  const human = escapeHtml(String(params.gateHumanLine ?? "").slice(0, 420));
  const scoreLine = Object.entries(params.preflight.scorecard)
    .map(([k, ok]) => `${escapeHtml(k)}:${ok ? "✓" : "✗"}`)
    .join(" ");
  const vetoes = escapeHtml(params.preflight.veto_reasons.join(", ").slice(0, 380));
  const px = Number.isFinite(Number(params.currentPrice))
    ? Number(params.currentPrice).toFixed(6)
    : "n/a";
  const gateDecision = escapeHtml(String(se.signal));
  const finalD = escapeHtml(String(params.finalDecision));
  const thr = escapeHtml(String(params.minAiConfidence));

  return (
    `<b>4. Strategy gate (tape math)</b>\n` +
    `   · <b>Price</b>: ${px}\n` +
    `   · <b>Strategy raw signal</b>: ${gateDecision} · <b>dominant blocker / path</b>: ${dominant}\n` +
    `   · <b>Strategy reason</b>: <code>${escapeHtml(String(se.strategy_reason))}</code>\n` +
    `   · <b>Matrix final</b>: ${finalD} · <b>min AI gate</b>: ${thr}\n` +
    `   · <b>Brain line</b>: ${human}\n` +
    `   · <b>Combined trace</b>: <code>${csr}</code>\n` +
    `   · <b>Preflight</b>: ${params.preflight.passedCount}/${params.preflight.totalGates} — ${scoreLine}\n` +
    `   · <b>Preflight vetoes</b>: ${vetoes || "—"}\n\n`
  );
}
