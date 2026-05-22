// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { isBinanceRestGatewayEnabled } from "./binance-rest-base.ts";
import { maybeNotifyDebuggerIssues } from "./debugger-alerts.ts";
import { runDebuggerAppliedFixes } from "./debugger-applied-fixes.ts";
import { summarizeRecentErrors } from "./debugger-error-triage.ts";
import {
  classifyHoldNoStrategyDominance,
  classifyPaperAutopilotDisabledIssue,
  classifyRecentErrorIssues,
  classifyStaleCapitalReservationIssue,
  classifySymbolCycleFailureIssue,
  collectMissingRequiredEnvIssues,
} from "./debugger-issue-rules.ts";
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

const ENV_ALIASES: Record<string, string[]> = {
  SUPABASE_URL: ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"],
  SUPABASE_SERVICE_ROLE_KEY: ["SUPABASE_SERVICE_ROLE_KEY", "DB_SERVICE_ROLE_KEY"],
  BOT_SECRET: ["BOT_SECRET", "BINANCE_BOT_SECRET", "CRON_SECRET"],
  BINANCE_API_KEY: ["BINANCE_API_KEY"],
  BINANCE_SECRET: ["BINANCE_SECRET", "BINANCE_API_SECRET", "BINANCE_SECRET_KEY"],
  TELEGRAM_CHAT_ID: ["TELEGRAM_CHAT_ID", "TELEGRAM_BOT_CHAT_ID"],
};

function hasEnv(name: string): boolean {
  const keys = ENV_ALIASES[name] ?? [name];
  return keys.some((k) => String(Deno.env.get(k) ?? "").trim().length > 0);
}

export async function runDebuggerHealthAndFix(params: {
  supabase: ReturnType<typeof createClient>;
  batchId: string;
  applyFixes?: boolean;
}): Promise<DebuggerHealthResult> {
  const { supabase, batchId, applyFixes = false } = params;
  const nowIso = new Date().toISOString();
  const issues: DebuggerIssue[] = [];
  const fixes: DebuggerFix[] = [];

  const missingEnvIssues = collectMissingRequiredEnvIssues(hasEnv, {
    gatewayEnabled: isBinanceRestGatewayEnabled(),
  });
  issues.push(...missingEnvIssues);
  const missingEnv = missingEnvIssues.flatMap((issue) =>
    Array.isArray(issue.detail?.missing_env)
      ? issue.detail.missing_env.map(String)
      : []
  );

  const lookbackIso = new Date(Date.now() - DEBUGGER_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const errorsLookbackIso = new Date(
    Date.now() - DEBUGGER_ERROR_LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const staleLockIso = new Date(Date.now() - DEBUGGER_LOCK_STALE_MS).toISOString();

  const [errorLogs, symbolFailures, staleLocks, recentWarRoom, errorSummary] = await Promise.all([
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
    summarizeRecentErrors({ supabase, sinceIso: errorsLookbackIso }),
  ]);

  const errorCount = asCount(errorLogs.count);
  const actionableErrorCount = errorSummary.actionable;
  const symbolFailureCount = asCount(symbolFailures.count);
  const staleLockCount = asCount(staleLocks.count);

  issues.push(...classifyRecentErrorIssues({
    errorCount,
    actionableErrorCount,
    resolvedErrorCount: errorSummary.resolved,
    breakdown: errorSummary.breakdown,
  }));

  const symbolFailureIssue = classifySymbolCycleFailureIssue(symbolFailureCount);
  if (symbolFailureIssue) issues.push(symbolFailureIssue);

  const staleLockIssue = classifyStaleCapitalReservationIssue(staleLockCount, staleLockIso);
  if (staleLockIssue) issues.push(staleLockIssue);

  if (Array.isArray(recentWarRoom.data) && recentWarRoom.data.length > 0) {
    const holdNoBuyCount = recentWarRoom.data.filter((row: any) => {
      const reason = String(row?.veto_details?.reason ?? "").toLowerCase();
      return reason === "hold_no_strategy_buy";
    }).length;
    const holdIssue = classifyHoldNoStrategyDominance(holdNoBuyCount, recentWarRoom.data.length);
    if (holdIssue) issues.push(holdIssue);
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
  const paperAutopilotIssue = classifyPaperAutopilotDisabledIssue(paperBotsToReenable);
  if (paperAutopilotIssue) issues.push(paperAutopilotIssue);

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
