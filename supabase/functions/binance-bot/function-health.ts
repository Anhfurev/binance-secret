// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { collectHealthSnapshot, runStaleTradeGuard } from "./health-check.ts";
import { runDebuggerHealthAndFix } from "./health-debugger.ts";

export type FunctionVitalityStatus = "alive" | "degraded" | "broken";

export function deriveVitalityStatus(params: {
  criticalIssues: number;
  warnIssues: number;
  fatal?: boolean;
}): FunctionVitalityStatus {
  if (params.fatal || params.criticalIssues > 0) return "broken";
  if (params.warnIssues > 0) return "degraded";
  return "alive";
}

export function vitalityHeadline(status: FunctionVitalityStatus): string {
  if (status === "alive") return "Edge bot is alive and passing health checks.";
  if (status === "degraded") return "Edge bot is running but degraded — review warnings.";
  return "Edge bot is broken — critical health checks failed.";
}

export async function runFunctionVitalityCheck(params: {
  supabase: ReturnType<typeof createClient>;
  batchId: string;
  runDebugger?: boolean;
  applyFixes?: boolean;
}) {
  const { supabase, batchId, runDebugger = true, applyFixes = false } = params;
  const snapshot = await collectHealthSnapshot({ supabase });
  let debuggerResult = null;
  if (runDebugger) {
    debuggerResult = await runDebuggerHealthAndFix({
      supabase,
      batchId,
      applyFixes,
    });
  }

  const criticalIssues = debuggerResult
    ? debuggerResult.issues.filter((issue) => issue.severity === "critical").length
    : snapshot.error_logs_last_hour > 20
    ? 1
    : 0;
  const warnIssues = debuggerResult
    ? debuggerResult.issues.filter((issue) => issue.severity === "warn").length
    : snapshot.error_logs_last_hour > 0
    ? 1
    : 0;
  const status = deriveVitalityStatus({ criticalIssues, warnIssues });
  const checkedAt = new Date().toISOString();

  return {
    status,
    alive: status !== "broken",
    ok: status !== "broken",
    checked_at: checkedAt,
    headline: vitalityHeadline(status),
    snapshot,
    debugger: debuggerResult
      ? {
        ok: debuggerResult.ok,
        checked_at: debuggerResult.checked_at,
        issues: debuggerResult.issues.map((issue) => ({
          code: issue.code,
          severity: issue.severity,
          message: issue.message,
        })),
        summary: debuggerResult.summary,
        fixes_applied: debuggerResult.fixes.filter((fix) => fix.applied).length,
      }
      : null,
  };
}

export async function handleFunctionHealthRequest(params: {
  supabase: ReturnType<typeof createClient>;
  applyFixes: boolean;
  includeStale: boolean;
  runDebugger: boolean;
}) {
  const startedAtMs = Date.now();
  const batchId = `alive-${crypto.randomUUID().slice(0, 8)}`;
  const functionHealth = await runFunctionVitalityCheck({
    supabase: params.supabase,
    batchId,
    runDebugger: params.runDebugger,
    applyFixes: params.applyFixes,
  });
  const staleTradeGuard = params.includeStale
    ? await runStaleTradeGuard({ supabase: params.supabase, batchId })
    : null;
  return {
    ok: functionHealth.ok,
    mode: "function_health",
    batch_id: batchId,
    elapsed_ms: Date.now() - startedAtMs,
    function_health: functionHealth,
    stale_trade_guard: staleTradeGuard,
  };
}

export function edgePingPayload() {
  return {
    ok: true,
    status: "alive" as const,
    mode: "ping",
    edge: "up",
    checked_at: new Date().toISOString(),
    headline: "Edge isolate is responding. Use function_health with BOT_SECRET for full diagnostics.",
  };
}

export function wantsFunctionHealth(
  parsedBody: Record<string, unknown> | null,
  searchParams: URLSearchParams,
): boolean {
  if (searchParams.get("function_health") === "1") return true;
  if (searchParams.get("test_debugger") === "1") return true;
  if (searchParams.get("alive") === "1") return true;
  return Boolean(
    parsedBody?.function_health ||
      parsedBody?.test_debugger ||
      parsedBody?.alive,
  );
}

export function readFunctionHealthFlags(parsedBody: Record<string, unknown> | null) {
  const applyFixes = parsedBody?.debugger_apply_fixes === true ||
    parsedBody?.apply_fixes === true;
  const includeStale = Boolean(
    parsedBody?.include_stale_guard ?? parsedBody?.debugger_include_retention,
  );
  const runDebugger = parsedBody?.debugger_health_only !== false;
  return { applyFixes, includeStale, runDebugger };
}
