// @ts-nocheck
/**
 * Opt-in Telegram "black box" visibility: why the bot held or bought each cycle.
 * Enable with `DECISION_TRACE_TELEGRAM=1`. HOLD-only traces throttle per symbol
 * (`DECISION_TRACE_HOLD_THROTTLE_MS`, default 1h). Any AI BUY or final BUY sends immediately.
 */
import type {
  AiAnalysis,
  BotSettingsRow,
  EntryCheckResult,
  IndicatorSnapshot,
  SignalDecision,
} from "./types.ts";
import { escapeHtml } from "./bot-shared.ts";
import { formatCycleReason } from "./index-decision-format.ts";
import { resolveMinTechScore } from "./utils.ts";
import { resolveStrategyBuyRsiMax } from "./config.ts";
import { sendTelegramAlert } from "./notifier.ts";
import {
  readTelegramSuppressHolds,
  readTelegramVerboseLogging,
} from "./telegram-notify-policy.ts";
import {
  describeStrategyGateHumanLine,
  formatAiPipelineIssueBannerHtml,
  formatStrategyGateTelegramSectionHtml,
  type PreflightSnapshot,
} from "./telegram-strategy-gate-format.ts";

const lastQuietTraceAtBySymbol = new Map<string, number>();

export function readDecisionTraceTelegramEnabled(): boolean {
  const raw = String(Deno.env.get("DECISION_TRACE_TELEGRAM") ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function readDecisionTraceHoldThrottleMs(): number {
  const rawStr = (Deno.env.get("DECISION_TRACE_HOLD_THROTTLE_MS") ?? "").trim();
  if (!rawStr.length) return 60 * 60 * 1000;
  const raw = Number(rawStr);
  if (!Number.isFinite(raw) || raw < 0) return 60 * 60 * 1000;
  return Math.min(24 * 60 * 60 * 1000, Math.floor(raw));
}

function shouldSendThisTrace(
  symbol: string,
  ai: AiAnalysis,
  finalDecision: SignalDecision,
  force: boolean,
): boolean {
  if (force) return true;
  if (String(ai.action).toUpperCase() === "BUY" || finalDecision === "BUY") return true;
  if (!readTelegramSuppressHolds()) return true;
  const throttle = readTelegramVerboseLogging()
    ? 0
    : readDecisionTraceHoldThrottleMs();
  if (throttle === 0) return true;
  const now = Date.now();
  const prev = lastQuietTraceAtBySymbol.get(symbol) ?? 0;
  if (now - prev < throttle) return false;
  lastQuietTraceAtBySymbol.set(symbol, now);
  return true;
}

function formatVetoLine(ai: AiAnalysis): string {
  const v = String(ai.groq_verdict ?? "").toUpperCase();
  if (!v) return "No Groq veto row (HOLD path or veto not run).";
  const r = String(ai.groq_reason ?? "").trim();
  const tail = r ? escapeHtml(r.slice(0, 220)) : "—";
  if (v === "REJECT") return `<b>Veto</b>: REJECT — ${tail}`;
  if (v === "APPROVE") return `<b>Veto</b>: APPROVE — ${tail}`;
  if (v === "SKIPPED") return `<b>Veto</b>: SKIPPED (fast-path / high conviction) — ${tail}`;
  return `<b>Veto</b>: ${escapeHtml(v)} — ${tail}`;
}

export async function maybeSendDecisionTraceTelegram(params: {
  row: BotSettingsRow;
  symbol: string;
  cycleId: string;
  snapshot: Pick<IndicatorSnapshot, "marketRegime" | "rsi" | "latestPrice">;
  ai: AiAnalysis;
  finalDecision: SignalDecision;
  reason?: string | null;
  technicalScore: number;
  strategySignal: SignalDecision;
  technicalSignal: SignalDecision;
  hasOpenTrade: boolean;
  minAiConfidence: number;
  /** Full snapshot for strategy-gate math line (RSI / EMA / volume). */
  snapshotFull?: IndicatorSnapshot;
  strategyEntry?: EntryCheckResult;
  strategyFailDetail?: string | null;
  combinedStrategyReason?: string;
  preflight?: PreflightSnapshot;
  aiQuotaFallback?: boolean;
  aiVerdictErrorDetail?: string | null;
  /** Bypass quiet-trace throttle (e.g. paper scenario second log). */
  force?: boolean;
}): Promise<void> {
  if (!readDecisionTraceTelegramEnabled()) return;
  const {
    row,
    symbol,
    cycleId,
    snapshot,
    ai,
    finalDecision,
    reason,
    technicalScore,
    strategySignal,
    technicalSignal,
    hasOpenTrade,
    minAiConfidence,
    force,
    snapshotFull,
    strategyEntry,
    strategyFailDetail,
    combinedStrategyReason,
    preflight,
    aiQuotaFallback,
    aiVerdictErrorDetail,
  } = params;
  if (!shouldSendThisTrace(symbol, ai, finalDecision, Boolean(force))) return;

  const minTech = resolveMinTechScore(row as Record<string, unknown>);
  const rsiBuyMax = resolveStrategyBuyRsiMax(row);
  const why = formatCycleReason(
    reason ?? undefined,
    ai,
    finalDecision,
    minAiConfidence,
    minTech,
    rsiBuyMax,
  );
  const icon =
    finalDecision === "BUY"
      ? "✅"
      : String(ai.action).toUpperCase() === "BUY"
      ? "⚠️"
      : "🧭";
  const prov = escapeHtml(String((ai as any).ai_provider ?? "unknown"));
  const path = escapeHtml(String((ai as any).ai_provider_path ?? "n/a"));
  const cache = escapeHtml(String((ai as any).ai_cache_status ?? "n/a"));
  const tip = escapeHtml(String(ai.pro_tip ?? "").trim() || "—");
  const regime = escapeHtml(String(snapshot.marketRegime ?? "n/a"));
  const rsi = Number.isFinite(Number(snapshot.rsi)) ? Number(snapshot.rsi).toFixed(1) : "n/a";
  const px = Number.isFinite(Number(snapshot.latestPrice))
    ? Number(snapshot.latestPrice).toFixed(6)
    : "n/a";

  const snapFull = snapshotFull ?? (snapshot as IndicatorSnapshot);
  const gateHuman =
    strategyEntry && preflight && combinedStrategyReason != null
      ? describeStrategyGateHumanLine({
        reason: reason ?? undefined,
        snapshot: snapFull,
        technicalScore,
        ai,
        finalDecision,
        minAiConfidence,
        minTech,
        row,
      })
      : "";
  const aiBanner = formatAiPipelineIssueBannerHtml({
    symbol,
    aiQuotaFallback: Boolean(aiQuotaFallback),
    aiVerdictErrorDetail: aiVerdictErrorDetail ?? null,
    ai,
  });
  const gateBlock =
    strategyEntry && preflight && combinedStrategyReason != null
      ? formatStrategyGateTelegramSectionHtml({
        symbol,
        strategyEntry,
        strategySignal,
        strategyFailDetail: strategyFailDetail ?? null,
        combinedStrategyReason,
        preflight,
        gateHumanLine: gateHuman,
        finalDecision,
        minAiConfidence,
        currentPrice: snapFull?.latestPrice,
      })
      : "";

  const html =
    (aiBanner ?? "") +
    `<b>${icon} DECISION TRACE</b> ${escapeHtml(symbol)}\n\n` +
    `<b>Final</b>: ${escapeHtml(finalDecision)} · <b>Open position</b>: ${hasOpenTrade ? "yes" : "no"}\n` +
    `<b>Why stopped / proceeded</b>: ${escapeHtml(why)}\n` +
    `<b>Reason code</b>: <code>${escapeHtml(String(reason ?? "n/a"))}</code>\n\n` +
    `<b>1. AI scan</b> (${prov})\n` +
    `   · path: ${path} · cache: ${cache}\n` +
    `   · action: <b>${escapeHtml(String(ai.action))}</b> · confidence: <b>${Number(ai.ai_confidence ?? 0).toFixed(1)}%</b>\n` +
    `   · trend: ${escapeHtml(String(ai.trend))} · align: ${ai.trend_alignment ? "yes" : "no"}\n` +
    `   · tip: <i>${tip}</i>\n\n` +
    `<b>2. Groq veto / trap</b>\n` +
    `   ${formatVetoLine(ai)}\n\n` +
    `<b>3. Tape / gates</b>\n` +
    `   · tech score: ${technicalScore}/10 · strategy: ${escapeHtml(strategySignal)} · technical: ${escapeHtml(technicalSignal)}\n` +
    `   · regime: ${regime} · RSI: ${rsi} · price: ${px}\n` +
    `   · min AI conf gate: ${minAiConfidence}\n\n` +
    gateBlock;

  await sendTelegramAlert(html, { cycleId });
}
