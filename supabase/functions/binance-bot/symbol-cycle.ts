// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { botDebug, botError } from "./bot-debug.ts";
import { applyBinanceCycleJitter, fetchIndicatorSnapshot } from "./binance.ts";
import {
  getCachedSnapshot,
  isEmergencyAbortQuotaError,
  lookupMarketSnapshotSync,
} from "./index-ai.ts";
import { isGeminiTerminalAuthError } from "./llm-key-backoff.ts";
import { safeExecute, safeExecuteDetached } from "./safe-execute.ts";
import { formatUnknownError, normalizeSymbol, resolveMinAiConfidenceForRegime, toStringValue } from "./utils.ts";
import { applyPaperScenarioOverlay } from "./paper-scenario-snapshot.ts";
import { decideSymbolCycleOutcome } from "./cycle-decider.ts";
import { executeSymbolCycleActions, handleCriticalSnapshotError } from "./cycle-executor.ts";
import { hasValidNonZeroEma } from "./cycle-indicator-helpers.ts";
import { logCycleSummary } from "./index-logging.ts";
import { sendDebuggerExceptionTelegram } from "./debugger-alerts.ts";
import {
  isHighRiskCrashRegime,
  loadBotGlobalSettings,
} from "./bot-global-settings.ts";

export async function executeSymbolCycle(params: {
  row: any;
  botIndex: number;
  signal: AbortSignal;
  supabase: ReturnType<typeof createClient>;
  symbolFilter: string;
  symbolCache: Map<string, import("./types.ts").IndicatorSnapshot>;
  lastAiPriceBySymbol: Map<string, number>;
  paperScenario?: { name: import("./paper-scenario-snapshot.ts").PaperScenarioName; execute: boolean } | null;
  cycleId: string;
  btcOverbought: boolean;
  symbolMatrixIndex?: number;
}) {
  const { row, botIndex, signal, supabase, symbolFilter, symbolCache, lastAiPriceBySymbol, paperScenario, cycleId, btcOverbought, symbolMatrixIndex } = params;
  const userId = toStringValue(row.user_id) ?? "unknown";
  const symbol = normalizeSymbol(row.symbol, symbolFilter);
  let minAiConfidence = resolveMinAiConfidenceForRegime(row as Record<string, unknown>, "NEUTRAL");
  botDebug("index", "bot_cycle_start", { userId, symbol, botIndex });
  const globalSettings = await loadBotGlobalSettings(supabase);
  if (isHighRiskCrashRegime(globalSettings.market_regime)) {
    console.warn(`[REGIME_GATE] HIGH_RISK_CRASH — halt symbol=${symbol} user=${userId}`);
    return {
      tag: "ok" as const,
      userId,
      symbol,
      detail: "HIGH_RISK_CRASH regime shield",
    };
  }
  try {
    await applyBinanceCycleJitter();
    const streamSnap = lookupMarketSnapshotSync(symbolCache, symbol);
    let snapshot = streamSnap ??
      await safeExecute(
        `market_snapshot_${symbol}`,
        () => getCachedSnapshot(symbolCache, symbol, fetchIndicatorSnapshot, signal),
        null,
      );
    if (!snapshot) throw new Error(`SNAPSHOT_UNAVAILABLE:${symbol}`);
    if (paperScenario?.name) snapshot = applyPaperScenarioOverlay(snapshot, paperScenario.name);
    minAiConfidence = resolveMinAiConfidenceForRegime(row as Record<string, unknown>, String(snapshot.marketRegime ?? "NEUTRAL"));
    if (!hasValidNonZeroEma(snapshot)) {
      await handleCriticalSnapshotError({ supabase, row, cycleId, symbol, reason: "CRITICAL_INDICATOR_ZERO", snapshot });
      return { tag: "critical" as const, error: new Error(`CRITICAL_INDICATOR_ZERO:${symbol}`) };
    }
    if (!Number.isFinite(snapshot.latestPrice) || snapshot.latestPrice <= 0) {
      await handleCriticalSnapshotError({ supabase, row, cycleId, symbol, reason: "CRITICAL_PRICE_ZERO", snapshot });
      return { tag: "critical" as const, error: new Error(`CRITICAL_PRICE_ZERO:${symbol}`) };
    }
    const outcome = await decideSymbolCycleOutcome({
      row,
      supabase,
      signal,
      symbol,
      userId,
      cycleId,
      snapshot,
      lastAiPriceBySymbol,
      paperScenario,
      btcOverbought,
      symbolMatrixIndex,
      globalSettings,
    });
    if (signal.aborted) {
      return { tag: "err" as const, userId, symbol, detail: `CYCLE_ABORTED:${symbol}` };
    }
    return await executeSymbolCycleActions({ row, supabase, userId, symbol, cycleId, snapshot, paperScenario, outcome, signal });
  } catch (error) {
    const detail = formatUnknownError(error);
    if (isGeminiTerminalAuthError(error)) {
      console.warn(`[AI DEBUG] ${symbol} symbol cycle skipped — Gemini terminal auth (${detail.slice(0, 200)})`);
      return { tag: "err" as const, userId, symbol, detail: `GEMINI_TERMINAL_AUTH:${detail.slice(0, 300)}` };
    }
    if (isEmergencyAbortQuotaError(error)) return { tag: "emergency" as const, userId, symbol, detail };
    if (detail.startsWith("CRITICAL_PRICE_ZERO:") || detail.startsWith("CRITICAL_INDICATOR_ZERO:")) return { tag: "critical" as const, error };
    botError("index", "bot_cycle_error", { userId, symbol, detail, rawError: error });
    await Promise.all([
      safeExecute("catch_bot_cycle_error_log", async () => {
        const errorObj = (error && typeof error === "object") ? (error as Record<string, unknown>) : null;
        await supabase.from("logs").insert([{
          user_id: userId !== "unknown" ? userId : null,
          symbol,
          level: "error",
          source: "bot-cycle-error",
          message: detail.slice(0, 500),
          meta: {
            event: "bot_cycle_error",
            symbol,
            detail,
            error_name: error instanceof Error ? error.name : (typeof errorObj?.name === "string" ? errorObj.name : null),
            error_code: typeof errorObj?.code === "string" ? errorObj.code : null,
            error_details: typeof errorObj?.details === "string" ? errorObj.details : null,
            error_hint: typeof errorObj?.hint === "string" ? errorObj.hint : null,
            stack: error instanceof Error ? error.stack?.slice(0, 1500) : null,
          },
          created_at: new Date().toISOString(),
        }]);
      }, undefined),
      safeExecute("catch_bot_cycle_summary_log", () => logCycleSummary({
        supabase,
        row,
        symbol,
        technicalScore: 0,
        strategySignal: "HOLD",
        ai: { ai_confidence: 0, trend: "neutral", trend_alignment: false, action: "HOLD", groq_verdict: undefined, groq_reason: undefined },
        reason: `runtime_error: ${detail}`,
        finalDecision: "HOLD",
        minAiConfidence,
        marketRegime: "NEUTRAL",
      }), undefined),
    ]);
    safeExecuteDetached(
      "debugger_exception_telegram",
      () => sendDebuggerExceptionTelegram({
        scope: `bot_cycle|${symbol}|${userId}`,
        detail,
        batchId: cycleId,
      }),
      undefined,
    );
    return { tag: "err" as const, userId, symbol, detail };
  }
}
