// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { BotActionResult } from "./types.ts";
import { executeSymbolCycle } from "./symbol-cycle.ts";
import { captureTraceReasonOnly } from "./symbol-cycle-trace.ts";
import { safeExecute, safeExecuteDetached } from "./safe-execute.ts";
import { formatUnknownError, normalizeSymbol, toStringValue } from "./utils.ts";
import { refreshExecutionFrictionSpreadBoost } from "./professional-expectancy.ts";

type CycleRunResult =
  | { tag: "ok"; result: BotActionResult; symbol: string; lastPrice: number }
  | { tag: "emergency"; userId: string; symbol: string; detail: string }
  | { tag: "critical"; error: unknown }
  | { tag: "err"; userId: string; symbol: string; detail: string }
  | { tag: "timeout"; userId: string; symbol: string; timeoutMs: number };

export async function runSingleBotCycleWithTimeout(
  task: (signal: AbortSignal) => Promise<Exclude<CycleRunResult, { tag: "timeout" }>>,
  timeoutMs: number,
  row: { user_id?: unknown; symbol?: unknown },
  symbolFallback: string,
  onLateCompletion?: (params: { userId: string; symbol: string; timeoutMs: number; detail: string }) => void | Promise<void>,
  parentSignal?: AbortSignal,
): Promise<CycleRunResult> {
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  const userId = toStringValue(row.user_id) ?? "unknown";
  const symbol = normalizeSymbol(row.symbol, symbolFallback);
  let timeoutFired = false;
  const taskPromise = task(signal);
  void taskPromise.then(
    () => timeoutFired && onLateCompletion?.({ userId, symbol, timeoutMs, detail: "task_resolved_after_timeout" }),
    (error) => timeoutFired && onLateCompletion?.({ userId, symbol, timeoutMs, detail: `task_rejected_after_timeout:${formatUnknownError(error)}` }),
  );
  const timeoutPromise = new Promise<{ tag: "timeout"; userId: string; symbol: string; timeoutMs: number }>((resolve) => {
    if (signal.aborted) {
      timeoutFired = true;
      resolve({ tag: "timeout", userId, symbol, timeoutMs });
      return;
    }
    signal.addEventListener("abort", () => {
      timeoutFired = true;
      resolve({ tag: "timeout", userId, symbol, timeoutMs });
    }, { once: true });
  });
  return await Promise.race([taskPromise, timeoutPromise]);
}

export async function orchestrateSymbolBatch(params: {
  supabase: ReturnType<typeof createClient>;
  symbolFilter: string;
  activeBots: any[];
  symbolCache: Map<string, import("./types.ts").IndicatorSnapshot>;
  lastAiPriceBySymbol: Map<string, number>;
  paperScenario?: { name: import("./paper-scenario-snapshot.ts").PaperScenarioName; execute: boolean } | null;
  cycleId: string;
  btcOverbought: boolean;
  btcMacroBounceGate: import("./macro-bounce-regime-gate.ts").BtcMacroBounceGate;
  botCycleTimeoutMs: number;
  symbolMatrixIndex?: number;
  cycleSignal?: AbortSignal;
  skipFrictionSpreadRefresh?: boolean;
  maxActiveBots?: number;
}) {
  const {
    supabase,
    symbolFilter,
    activeBots: activeBotsIn,
    symbolCache,
    lastAiPriceBySymbol,
    paperScenario,
    cycleId,
    btcOverbought,
    btcMacroBounceGate,
    botCycleTimeoutMs,
    symbolMatrixIndex,
    cycleSignal,
    skipFrictionSpreadRefresh,
    maxActiveBots,
  } = params;
  const activeBots = (() => {
    const cap = Number(maxActiveBots);
    if (!Number.isFinite(cap) || cap <= 0) return activeBotsIn;
    return activeBotsIn.slice(0, Math.floor(cap));
  })();
  if (cycleSignal?.aborted) {
    return { actions: [], cycleEmergencyAbort: false, allSettledElapsedMs: 0, scanned: 0 };
  }
  if (!skipFrictionSpreadRefresh) {
    await safeExecute("refresh_friction_spread_boost", () => refreshExecutionFrictionSpreadBoost(supabase), undefined);
  }
  const actions: BotActionResult[] = [];
  let cycleEmergencyAbort = false;
  const allSettledStarted = performance.now();
  const runOne = (botIndex: number) => {
    const row = activeBots[botIndex];
    return runSingleBotCycleWithTimeout(
      (signal) =>
        executeSymbolCycle({
          row,
          botIndex,
          signal,
          supabase,
          symbolFilter,
          symbolCache,
          lastAiPriceBySymbol,
          paperScenario,
          cycleId,
          btcOverbought,
          btcMacroBounceGate,
          symbolMatrixIndex,
        }),
      botCycleTimeoutMs,
      row,
      symbolFilter,
      ({ userId, symbol, timeoutMs, detail }) =>
        safeExecute("late_completion_after_timeout_log", () => supabase.from("logs").insert([{
          user_id: userId !== "unknown" ? userId : null,
          symbol,
          level: "warn",
          source: "bot-timeout-race",
          message: "late_completion_after_timeout",
          meta: { event: "late_completion_after_timeout", timeout_ms: timeoutMs, detail, cycle_id: cycleId },
          created_at: new Date().toISOString(),
        }]), undefined),
      cycleSignal,
    );
  };
  const settled = await Promise.allSettled(
    activeBots.map((_, botIndex) => runOne(botIndex)),
  );
  settled.forEach((entry, botIndex) => {
    const row = activeBots[botIndex] as { user_id?: unknown; symbol?: unknown };
    const userId = toStringValue(row.user_id) ?? "unknown";
    const symbol = normalizeSymbol(row.symbol, symbolFilter);
    if (entry.status !== "fulfilled") {
      actions.push({ userId, symbol, decision: "HOLD", action: "error", detail: formatUnknownError(entry.reason) });
      return;
    }
    const o = entry.value;
    if (o.tag === "ok") {
      actions.push(o.result);
      lastAiPriceBySymbol.set(o.symbol, o.lastPrice);
    } else if (o.tag === "emergency") {
      cycleEmergencyAbort = true;
      actions.push({ userId: o.userId, symbol: o.symbol, decision: "HOLD", action: "error", detail: o.detail });
    } else if (o.tag === "critical") {
      actions.push({ userId, symbol, decision: "HOLD", action: "error", detail: formatUnknownError(o.error) });
    } else if (o.tag === "timeout") {
      safeExecuteDetached(
        "capture_trace_reason_only",
        () => captureTraceReasonOnly({
          supabase,
          userId: o.userId !== "unknown" ? o.userId : null,
          botId: toStringValue((activeBots[botIndex] as any)?.id) ?? null,
          cycleId,
          symbol: o.symbol,
          decision: "HOLD",
          reason: `TIMEOUT_HOLD:${o.timeoutMs}ms`,
          perfMetadata: { is_timeout: true, timeout_ms: o.timeoutMs },
        }),
        undefined,
      );
      actions.push({ userId: o.userId, symbol: o.symbol, decision: "HOLD", action: "skip", detail: `TIMEOUT_HOLD:${o.timeoutMs}ms` });
    } else {
      actions.push({ userId: o.userId, symbol: o.symbol, decision: "HOLD", action: "error", detail: o.detail });
    }
  });
  return { actions, cycleEmergencyAbort, allSettledElapsedMs: Math.round(performance.now() - allSettledStarted), scanned: activeBots.length };
}
