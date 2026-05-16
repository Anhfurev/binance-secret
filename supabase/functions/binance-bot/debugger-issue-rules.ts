// @ts-nocheck

import { getGeminiKeysFromEnv } from "./ai-keys.ts";

export type DebuggerIssueSeverity = "info" | "warn" | "critical";

export type DebuggerIssueRule = {
  code: string;
  severity: DebuggerIssueSeverity;
  message: string;
  detail?: Record<string, unknown>;
};

/** CRIT `ERROR_SPIKE_RECENT` when actionable errors in last 2h ≥ this (see `summarizeRecentErrors`). */
export function readDebuggerErrorSpikeThreshold(): number {
  const raw = String(Deno.env.get("DEBUGGER_ERROR_SPIKE_THRESHOLD") ?? "50").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(500, Math.floor(n));
}

export function readDebuggerHoldNoStrategyWarnCount(): number {
  const raw = String(Deno.env.get("DEBUGGER_HOLD_NO_STRATEGY_WARN_COUNT") ?? "28").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 28;
  return Math.min(40, Math.floor(n));
}

export function readDebuggerTightTrailMinPct(): number {
  const raw = String(Deno.env.get("DEBUGGER_TIGHT_TRAIL_MIN_PCT") ?? "0.5").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0.5;
  return Math.min(5, n);
}

export function collectMissingRequiredEnvIssues(
  hasEnv: (name: string) => boolean,
  opts: { gatewayEnabled: boolean },
): DebuggerIssueRule[] {
  const requiredEnv = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "BOT_SECRET",
    "TELEGRAM_BOT_TOKEN",
  ];
  const missingEnv = requiredEnv.filter((name) => !hasEnv(name));
  if (getGeminiKeysFromEnv().length === 0) {
    missingEnv.push("GEMINI_API_KEY (or GEMINI_KEYS_POOL / GEMINI_KEY_n)");
  }
  if (
    !hasEnv("BINANCE_SECRET_KEY") &&
    !hasEnv("BINANCE_SECRET") &&
    !hasEnv("BINANCE_API_SECRET")
  ) {
    missingEnv.push("BINANCE_SECRET (or BINANCE_API_SECRET)");
  }
  if (!hasEnv("BINANCE_API_KEY")) {
    missingEnv.push("BINANCE_API_KEY");
  }
  if (!hasEnv("TELEGRAM_CHAT_ID") && !hasEnv("TELEGRAM_BOT_CHAT_ID")) {
    missingEnv.push("TELEGRAM_CHAT_ID (or TELEGRAM_BOT_CHAT_ID)");
  }
  if (!missingEnv.length) return [];

  const binanceOnly = missingEnv.every((name) => name.includes("BINANCE"));
  const severity: DebuggerIssueSeverity = opts.gatewayEnabled && binanceOnly
    ? "warn"
    : "critical";
  return [{
    code: "MISSING_REQUIRED_ENV",
    severity,
    message: opts.gatewayEnabled && binanceOnly
      ? "Binance REST credentials are missing on Edge — gateway mode may still work"
      : "One or more required runtime secrets are missing",
    detail: { missing_env: missingEnv, gateway_enabled: opts.gatewayEnabled },
  }];
}

export function classifyRecentErrorIssues(params: {
  errorCount: number;
  actionableErrorCount: number;
  resolvedErrorCount: number;
  breakdown: Record<string, number>;
}): DebuggerIssueRule[] {
  const spikeThreshold = readDebuggerErrorSpikeThreshold();
  const detail = {
    error_count_last_2h: params.errorCount,
    actionable_error_count_last_2h: params.actionableErrorCount,
    resolved_error_count_last_2h: params.resolvedErrorCount,
    error_breakdown: params.breakdown,
  };
  if (params.actionableErrorCount >= spikeThreshold) {
    return [{
      code: "ERROR_SPIKE_RECENT",
      severity: "critical",
      message: "Recent runtime error volume is high",
      detail,
    }];
  }
  if (params.actionableErrorCount > 0) {
    return [{
      code: "ERRORS_RECENT",
      severity: "warn",
      message: "Recent runtime errors were detected",
      detail,
    }];
  }
  if (params.errorCount > 0) {
    return [{
      code: "ERRORS_RESOLVED_ONLY",
      severity: "info",
      message: "Recent errors are from a fixed deploy issue and can be ignored",
      detail,
    }];
  }
  return [];
}

export function classifySymbolCycleFailureIssue(count: number): DebuggerIssueRule | null {
  if (count <= 0) return null;
  return {
    code: "SYMBOL_CYCLE_FAILURES",
    severity: count >= 6 ? "critical" : "warn",
    message: "Symbol cycle failures detected in recent runs",
    detail: { symbol_cycle_failed_last_6h: count },
  };
}

export function classifyStaleCapitalReservationIssue(
  count: number,
  staleBeforeIso: string,
): DebuggerIssueRule | null {
  if (count <= 0) return null;
  return {
    code: "STALE_CAPITAL_RESERVATIONS",
    severity: count >= 10 ? "critical" : "warn",
    message: "Stale capital reservations can block BUY executions",
    detail: { stale_count: count, stale_before: staleBeforeIso },
  };
}

export function classifyHoldNoStrategyDominance(
  holdCount: number,
  sampleSize: number,
): DebuggerIssueRule | null {
  const warnCount = readDebuggerHoldNoStrategyWarnCount();
  if (holdCount < warnCount || sampleSize <= 0) return null;
  return {
    code: "HOLD_NO_STRATEGY_DOMINANT",
    severity: "warn",
    message: "Most recent cycles are HOLD due to strategy gate",
    detail: {
      hold_no_strategy_buy_recent: holdCount,
      sample_size: sampleSize,
    },
  };
}

export function classifyPaperAutopilotDisabledIssue(
  bots: Array<{ id?: string; user_id?: string; symbol?: string }>,
): DebuggerIssueRule | null {
  if (!bots.length) return null;
  return {
    code: "PAPER_AUTOPILOT_DISABLED",
    severity: "warn",
    message: "Paper bots have autopilot OFF — likely from past drawdown breach",
    detail: {
      affected: bots.length,
      sample: bots.slice(0, 5).map((row) => ({
        id: row.id,
        user_id: row.user_id,
        symbol: row.symbol,
      })),
    },
  };
}

export function trailDistancePctFromTrade(
  entryPrice: number,
  extra: Record<string, unknown> | null | undefined,
): number | null {
  if (!extra || typeof extra !== "object") return null;
  const trailDistance = Number(extra.trail_distance_price);
  if (Number.isFinite(trailDistance) && trailDistance > 0 && entryPrice > 0) {
    return (trailDistance / entryPrice) * 100;
  }
  const trailingPct = Number(extra.trailing_stop_pct);
  if (Number.isFinite(trailingPct) && trailingPct > 0) {
    const normalized = trailingPct > 1 ? trailingPct / 100 : trailingPct;
    return normalized * 100;
  }
  return null;
}

export function classifyTightTrailingExitIssue(
  stops: Array<{
    symbol?: string | null;
    entryPrice?: number | null;
    extra?: Record<string, unknown> | null;
  }>,
): DebuggerIssueRule | null {
  const minPct = readDebuggerTightTrailMinPct();
  const samples: Array<{ symbol: string; trail_distance_pct: number }> = [];
  for (const row of stops) {
    const entry = Number(row.entryPrice ?? 0);
    const trailPct = trailDistancePctFromTrade(entry, row.extra ?? null);
    if (trailPct == null || trailPct >= minPct) continue;
    samples.push({
      symbol: String(row.symbol ?? "unknown"),
      trail_distance_pct: Number(trailPct.toFixed(4)),
    });
  }
  if (samples.length < 3) return null;
  return {
    code: "TIGHT_TRAILING_EXITS",
    severity: "warn",
    message: "Recent paper stops are using very tight trailing distances",
    detail: {
      min_trail_distance_pct: minPct,
      sample_count: samples.length,
      samples: samples.slice(0, 5),
      hint: "Check ATR burst trail widening and meme/major trailing floors in bot_settings.",
    },
  };
}
