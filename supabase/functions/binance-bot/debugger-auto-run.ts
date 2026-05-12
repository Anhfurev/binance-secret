// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { maybeNotifyDebuggerIssues } from "./debugger-alerts.ts";
import { runDebuggerHealthAndFix } from "./health-debugger.ts";

let lastScheduledDebuggerAtMs = 0;

function readDebuggerAutoIntervalMs(): number {
  const raw = String(Deno.env.get("DEBUGGER_AUTO_INTERVAL_MS") ?? "1800000").trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) return 30 * 60 * 1000;
  if (n <= 0) return 0;
  return Math.min(6 * 60 * 60 * 1000, Math.floor(n));
}

export async function maybeRunScheduledDebugger(
  supabase: ReturnType<typeof createClient>,
  batchId: string,
): Promise<Record<string, unknown> | null> {
  const intervalMs = readDebuggerAutoIntervalMs();
  if (intervalMs <= 0) return null;
  const now = Date.now();
  if (now - lastScheduledDebuggerAtMs < intervalMs) return null;
  lastScheduledDebuggerAtMs = now;

  const result = await runDebuggerHealthAndFix({
    supabase,
    batchId: `auto-${batchId.slice(0, 8)}`,
    applyFixes: true,
  });
  await maybeNotifyDebuggerIssues({
    issues: result.issues,
    batchId: `auto-${batchId.slice(0, 8)}`,
    source: "scheduled_cron",
  });
  return {
    ok: result.ok,
    issues_count: result.issues.length,
    critical_count: result.issues.filter((i) => i.severity === "critical").length,
    fixes_count: result.fixes.length,
    summary: result.summary,
  };
}
