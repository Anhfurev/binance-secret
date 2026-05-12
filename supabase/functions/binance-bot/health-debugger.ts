// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { maybeNotifyDebuggerIssues } from "./debugger-alerts.ts";
import { runDebuggerAppliedFixes } from "./debugger-applied-fixes.ts";
import { runOpsProbes } from "./debugger-ops-probes.ts";

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
    "BINANCE_API_KEY",
  ];
  const missingEnv = requiredEnv.filter((name) => !hasEnv(name));
  if (
    !hasEnv("BINANCE_SECRET_KEY") &&
    !hasEnv("BINANCE_SECRET") &&
    !hasEnv("BINANCE_API_SECRET")
  ) {
    missingEnv.push("BINANCE_SECRET (or BINANCE_API_SECRET)");
  }
  if (!hasEnv("TELEGRAM_CHAT_ID") && !hasEnv("TELEGRAM_BOT_CHAT_ID")) {
    missingEnv.push("TELEGRAM_CHAT_ID (or TELEGRAM_BOT_CHAT_ID)");
  }
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
      .limit(40),
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
    if (holdNoBuyCount >= 28) {
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

  const disabledPaperBots = await supabase
    .from("bot_settings")
    .select("id,user_id,symbol,is_autopilot_enabled,is_live_trading_enabled,is_ghost_execution")
    .eq("is_autopilot_enabled", false)
    .eq("is_live_trading_enabled", false);
  const paperBotsToReenable = Array.isArray(disabledPaperBots.data)
    ? disabledPaperBots.data.filter((r: { is_ghost_execution?: boolean }) =>
      r && !r.is_ghost_execution
    )
    : [];
  if (paperBotsToReenable.length > 0) {
    issues.push({
      code: "PAPER_AUTOPILOT_DISABLED",
      severity: "warn",
      message: "Paper bots have autopilot OFF — likely from past drawdown breach",
      detail: {
        affected: paperBotsToReenable.length,
        sample: paperBotsToReenable.slice(0, 5).map((r: {
          id?: string;
          user_id?: string;
          symbol?: string;
        }) => ({
          id: r.id,
          user_id: r.user_id,
          symbol: r.symbol,
        })),
      },
    });
  }

  if (applyFixes) {
    fixes.push(
      ...await runDebuggerAppliedFixes({
        supabase,
        applyFixes,
        staleLockIso,
        staleLockCount,
      }),
    );
  }

  const ops = await runOpsProbes(supabase);
  issues.push(...ops.issues);

  await maybeNotifyDebuggerIssues({
    issues,
    batchId,
    source: applyFixes ? "debugger_health" : "debugger_health_readonly",
  });

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
      ...ops.summary,
    },
  };
}
