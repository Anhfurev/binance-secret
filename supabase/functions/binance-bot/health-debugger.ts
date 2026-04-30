// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { getAiQuotaState, patchAiQuotaState } from "./ai-db.ts";

const DEBUGGER_LOCK_STALE_MS = 10 * 60 * 1000;
const DEBUGGER_LOOKBACK_HOURS = 6;
const DEBUGGER_ERROR_LOOKBACK_HOURS = 2;

type DebuggerIssueSeverity = "info" | "warn" | "critical";

export type DebuggerIssue = {
  code: string;
  severity: DebuggerIssueSeverity;
  message: string;
  detail?: Record<string, unknown>;
};

export type DebuggerFix = {
  code: string;
  applied: boolean;
  note: string;
  detail?: Record<string, unknown>;
};

export type DebuggerHealthResult = {
  ok: boolean;
  checked_at: string;
  issues: DebuggerIssue[];
  fixes: DebuggerFix[];
  summary: Record<string, unknown>;
};

function asCount(value: unknown): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function hasEnv(name: string): boolean {
  return String(Deno.env.get(name) ?? "").trim().length > 0;
}

export async function runDebuggerHealthAndFix(params: {
  supabase: ReturnType<typeof createClient>;
  batchId: string;
  applyFixes?: boolean;
}): Promise<DebuggerHealthResult> {
  const { supabase, batchId, applyFixes = true } = params;
  const nowIso = new Date().toISOString();
  const issues: DebuggerIssue[] = [];
  const fixes: DebuggerFix[] = [];

  const requiredEnv = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "BOT_SECRET",
    "GEMINI_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "BINANCE_API_KEY",
    "BINANCE_SECRET_KEY",
  ];
  const missingEnv = requiredEnv.filter((name) => !hasEnv(name));
  if (missingEnv.length > 0) {
    issues.push({
      code: "MISSING_REQUIRED_ENV",
      severity: "critical",
      message: "One or more required runtime secrets are missing",
      detail: { missing_env: missingEnv },
    });
  }

  const lookbackIso = new Date(Date.now() - DEBUGGER_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const errorsLookbackIso = new Date(
    Date.now() - DEBUGGER_ERROR_LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const staleLockIso = new Date(Date.now() - DEBUGGER_LOCK_STALE_MS).toISOString();

  const [errorLogs, symbolFailures, staleLocks, recentWarRoom] = await Promise.all([
    supabase
      .from("logs")
      .select("id", { count: "exact", head: true })
      .eq("level", "error")
      .gte("created_at", errorsLookbackIso),
    supabase
      .from("logs")
      .select("id", { count: "exact", head: true })
      .eq("message", "symbol_cycle_failed")
      .gte("created_at", lookbackIso),
    supabase
      .from("capital_reservations")
      .select("id", { count: "exact", head: true })
      .lt("created_at", staleLockIso),
    supabase
      .from("war_room_audits")
      .select("final_decision,veto_details")
      .order("created_at", { ascending: false })
      .limit(120),
  ]);

  const errorCount = asCount(errorLogs.count);
  const symbolFailureCount = asCount(symbolFailures.count);
  const staleLockCount = asCount(staleLocks.count);

  if (errorCount >= 20) {
    issues.push({
      code: "ERROR_SPIKE_RECENT",
      severity: "critical",
      message: "Recent runtime error volume is high",
      detail: { error_count_last_2h: errorCount },
    });
  } else if (errorCount > 0) {
    issues.push({
      code: "ERRORS_RECENT",
      severity: "warn",
      message: "Recent runtime errors were detected",
      detail: { error_count_last_2h: errorCount },
    });
  }

  if (symbolFailureCount > 0) {
    issues.push({
      code: "SYMBOL_CYCLE_FAILURES",
      severity: symbolFailureCount >= 6 ? "critical" : "warn",
      message: "Symbol cycle failures detected in recent runs",
      detail: { symbol_cycle_failed_last_6h: symbolFailureCount },
    });
  }

  if (staleLockCount > 0) {
    issues.push({
      code: "STALE_CAPITAL_RESERVATIONS",
      severity: staleLockCount >= 10 ? "critical" : "warn",
      message: "Stale capital reservations can block BUY executions",
      detail: { stale_count: staleLockCount, stale_before: staleLockIso },
    });
  }

  if (Array.isArray(recentWarRoom.data) && recentWarRoom.data.length > 0) {
    const holdNoBuyCount = recentWarRoom.data.filter((row: any) => {
      const reason = String(row?.veto_details?.reason ?? "").toLowerCase();
      return reason === "hold_no_strategy_buy";
    }).length;
    if (holdNoBuyCount >= 80) {
      issues.push({
        code: "HOLD_NO_STRATEGY_DOMINANT",
        severity: "warn",
        message: "Most recent cycles are HOLD due to strategy gate",
        detail: {
          hold_no_strategy_buy_recent: holdNoBuyCount,
          sample_size: recentWarRoom.data.length,
        },
      });
    }
  }

  if (applyFixes && staleLockCount > 0) {
    const staleDelete = await supabase
      .from("capital_reservations")
      .delete({ count: "exact" })
      .lt("created_at", staleLockIso);
    fixes.push({
      code: "PURGE_STALE_CAPITAL_RESERVATIONS",
      applied: !staleDelete.error,
      note: staleDelete.error ? staleDelete.error.message : "Removed stale reservation locks",
      detail: { deleted: staleDelete.count ?? 0 },
    });
  }

  if (applyFixes) {
    const quota = await getAiQuotaState("global");
    const cooldownMs = Date.parse(String(quota?.gemini_cooldown_until ?? ""));
    if (quota && Number.isFinite(cooldownMs) && cooldownMs < Date.now()) {
      await patchAiQuotaState({
        consecutive_gemini_failures: 0,
        gemini_cooldown_until: null,
        last_failure_at: null,
      }, "global");
      fixes.push({
        code: "RESET_STALE_AI_COOLDOWN",
        applied: true,
        note: "AI cooldown had expired and was reset",
        detail: {
          previous_failures: quota.consecutive_gemini_failures,
          previous_cooldown_until: quota.gemini_cooldown_until,
        },
      });
    }
  }

  await supabase.from("logs").insert([{
    level: issues.some((i) => i.severity === "critical") ? "warn" : "info",
    source: "debugger-health",
    message: "debugger_health_check",
    meta: {
      event: "debugger_health_check",
      batch_id: batchId,
      issues_count: issues.length,
      fixes_count: fixes.length,
      critical_count: issues.filter((i) => i.severity === "critical").length,
      apply_fixes: applyFixes,
      issues,
      fixes,
    },
    created_at: nowIso,
  }]);

  return {
    ok: issues.every((issue) => issue.severity !== "critical"),
    checked_at: nowIso,
    issues,
    fixes,
    summary: {
      missing_env_count: missingEnv.length,
      error_count_last_2h: errorCount,
      symbol_cycle_failed_last_6h: symbolFailureCount,
      stale_capital_reservations: staleLockCount,
    },
  };
}
