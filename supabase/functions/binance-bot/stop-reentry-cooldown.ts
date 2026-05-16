// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import {
  readStopStreakBlacklistDurationMs,
  readStopStreakBlacklistStops,
  readStopStreakBlacklistWindowMs,
} from "./regime-scaling.ts";

export function readSymbolCooldownMinutes(): number {
  const raw = String(Deno.env.get("SYMBOL_COOLDOWN_MINUTES") ?? "30").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 30;
  return Math.min(24 * 60, Math.floor(n));
}

export function readPostStoplossReentryCooldownMs(paperOnly = false): number {
  if (paperOnly) {
    const raw = String(Deno.env.get("PAPER_POST_STOP_REENTRY_COOLDOWN_MS") ?? "1800000").trim();
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) {
      return Math.min(24 * 60 * 60 * 1000, Math.floor(n));
    }
    return 8 * 60 * 1000;
  }
  const raw = String(Deno.env.get("POST_STOPLOSS_REENTRY_COOLDOWN_MS") ?? "").trim();
  if (raw.length) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) {
      return Math.min(24 * 60 * 60 * 1000, Math.floor(n));
    }
  }
  return readSymbolCooldownMinutes() * 60 * 1000;
}

export function readStopChurnWindowMs(paperOnly = false): number {
  if (paperOnly) {
    const raw = String(Deno.env.get("PAPER_STOP_CHURN_WINDOW_MS") ?? "").trim();
    if (raw.length) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 60_000) {
        return Math.min(24 * 60 * 60 * 1000, Math.floor(n));
      }
    }
    return 6 * 60 * 60 * 1000;
  }
  const raw = String(Deno.env.get("STOP_CHURN_WINDOW_MS") ?? "1800000").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 60_000) return 30 * 60 * 1000;
  return Math.min(2 * 60 * 60 * 1000, Math.floor(n));
}

export function readStopChurnMaxStops(paperOnly = false): number {
  if (paperOnly) {
    const raw = String(Deno.env.get("PAPER_STOP_CHURN_MAX_STOPS") ?? "3").trim();
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return 3;
    return Math.min(6, Math.floor(n));
  }
  const raw = String(Deno.env.get("STOP_CHURN_MAX_STOPS") ?? "1").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(6, Math.floor(n));
}

const RECENT_LOSS_COOLDOWN_MIN_PNL_PCT = -0.3;

function isProfitableTrailingStopExit(
  exitReason: unknown,
  pnl: number,
  pnlPercent: number,
): boolean {
  const reason = String(exitReason ?? "").toLowerCase();
  const trailing =
    reason === "money_machine_trailing_lock" || reason.includes("trailing");
  if (!trailing) return false;
  if (pnl > 0) return true;
  return Number.isFinite(pnlPercent) && pnlPercent > 0;
}

export async function blockedByPostStoplossCooldown(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  paperOnly?: boolean;
}): Promise<{ blocked: boolean; reason?: string }> {
  const cooldownMs = readPostStoplossReentryCooldownMs(Boolean(params.paperOnly));
  if (cooldownMs <= 0) return { blocked: false };
  const sinceIso = new Date(Date.now() - cooldownMs).toISOString();
  const { data, error } = await params.supabase
    .from("trades")
    .select("id,closed_at,exit_reason")
    .eq("user_id", params.userId)
    .eq("symbol", params.symbol)
    .in("status", ["closed", "stopped"])
    .in("exit_reason", ["stoploss_hit", "trailing_stop_hit", "be_stop_hit"])
    .gte("closed_at", sinceIso)
    .order("closed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { blocked: false };
  return {
    blocked: true,
    reason: `hold_post_stoploss_cooldown_${Math.round(cooldownMs / 1000)}s`,
  };
}

export async function blockedByRecentLosingClose(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  paperOnly?: boolean;
}): Promise<{ blocked: boolean; reason?: string }> {
  const cooldownMs = readPostStoplossReentryCooldownMs(Boolean(params.paperOnly));
  if (cooldownMs <= 0) return { blocked: false };
  const sinceIso = new Date(Date.now() - cooldownMs).toISOString();
  const { data, error } = await params.supabase
    .from("trades")
    .select("id,closed_at,pnl,pnlPercent,exit_reason")
    .eq("user_id", params.userId)
    .eq("symbol", params.symbol)
    .in("status", ["closed", "stopped"])
    .gte("closed_at", sinceIso)
    .order("closed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { blocked: false };
  const pnl = Number(data.pnl);
  const pnlPercent = Number(data.pnlPercent);
  if (isProfitableTrailingStopExit(data.exit_reason, pnl, pnlPercent)) {
    return { blocked: false };
  }
  if (!(pnl < 0)) return { blocked: false };
  if (!Number.isFinite(pnlPercent) || pnlPercent > RECENT_LOSS_COOLDOWN_MIN_PNL_PCT) {
    return { blocked: false };
  }
  return {
    blocked: true,
    reason: `hold_post_loss_cooldown_${Math.round(cooldownMs / 1000)}s`,
  };
}

export async function blockedByRecentStopChurn(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  paperOnly?: boolean;
}): Promise<{ blocked: boolean; reason?: string }> {
  const windowMs = readStopChurnWindowMs(Boolean(params.paperOnly));
  const maxStops = readStopChurnMaxStops(Boolean(params.paperOnly));
  const sinceIso = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await params.supabase
    .from("trades")
    .select("id", { count: "exact", head: true })
    .eq("user_id", params.userId)
    .eq("symbol", params.symbol)
    .in("status", ["closed", "stopped"])
    .in("exit_reason", ["stoploss_hit", "trailing_stop_hit", "be_stop_hit"])
    .gte("closed_at", sinceIso);
  if (error) throw error;
  if ((count ?? 0) >= maxStops) {
    return {
      blocked: true,
      reason: `hold_stop_churn_${count}_in_${Math.round(windowMs / 60_000)}m`,
    };
  }
  return { blocked: false };
}

export async function blockedByStoplossStreakBlacklist(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
}): Promise<{ blocked: boolean; reason?: string }> {
  const streak = readStopStreakBlacklistStops();
  const windowMs = readStopStreakBlacklistWindowMs();
  const blacklistMs = readStopStreakBlacklistDurationMs();
  const sinceIso = new Date(Date.now() - windowMs).toISOString();
  const { data, error } = await params.supabase
    .from("trades")
    .select("closed_at,exit_reason")
    .eq("user_id", params.userId)
    .eq("symbol", params.symbol)
    .in("status", ["closed", "stopped"])
    .gte("closed_at", sinceIso)
    .order("closed_at", { ascending: false })
    .limit(streak);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  if (rows.length < streak) return { blocked: false };
  if (!rows.every((row) => String(row.exit_reason ?? "") === "stoploss_hit")) {
    return { blocked: false };
  }
  const newestClosedAt = Date.parse(String(rows[0]?.closed_at ?? ""));
  if (!Number.isFinite(newestClosedAt)) return { blocked: false };
  const blacklistUntil = newestClosedAt + blacklistMs;
  if (Date.now() >= blacklistUntil) return { blocked: false };
  return {
    blocked: true,
    reason: `hold_stoploss_streak_blacklist_${streak}_in_${Math.round(windowMs / 3_600_000)}h_until_${new Date(blacklistUntil).toISOString()}`,
  };
}

export function readPortfolioStopClusterWindowMs(paperOnly = false): number {
  if (paperOnly) {
    const raw = String(Deno.env.get("PAPER_PORTFOLIO_STOP_WINDOW_MS") ?? "").trim();
    if (raw.length) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 60_000) {
        return Math.min(12 * 60 * 60 * 1000, Math.floor(n));
      }
    }
    return 2 * 60 * 60 * 1000;
  }
  return readStopChurnWindowMs(false);
}

export function readPortfolioStopClusterMax(paperOnly = false): number {
  if (paperOnly) {
    const raw = String(Deno.env.get("PAPER_PORTFOLIO_STOP_MAX") ?? "3").trim();
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 2) return 3;
    return Math.min(8, Math.floor(n));
  }
  return readStopChurnMaxStops(false);
}

export async function blockedByPortfolioStopCluster(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  paperOnly?: boolean;
}): Promise<{ blocked: boolean; reason?: string }> {
  if (!params.paperOnly) return { blocked: false };
  const windowMs = readPortfolioStopClusterWindowMs(true);
  const maxStops = readPortfolioStopClusterMax(true);
  const sinceIso = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await params.supabase
    .from("trades")
    .select("id", { count: "exact", head: true })
    .eq("user_id", params.userId)
    .in("status", ["closed", "stopped"])
    .in("exit_reason", ["stoploss_hit", "trailing_stop_hit", "be_stop_hit"])
    .gte("closed_at", sinceIso);
  if (error) throw error;
  if ((count ?? 0) >= maxStops) {
    return {
      blocked: true,
      reason: `hold_portfolio_stop_cluster_${count}_in_${Math.round(windowMs / 60_000)}m`,
    };
  }
  return { blocked: false };
}

export async function blockedByBuyReentryGuards(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  paperOnly?: boolean;
}): Promise<{ blocked: boolean; reason?: string }> {
  const portfolioCluster = await blockedByPortfolioStopCluster(params);
  if (portfolioCluster.blocked) return portfolioCluster;
  const streakBlacklist = await blockedByStoplossStreakBlacklist(params);
  if (streakBlacklist.blocked) return streakBlacklist;
  const stopCooldown = await blockedByPostStoplossCooldown(params);
  if (stopCooldown.blocked) return stopCooldown;
  const lossCooldown = await blockedByRecentLosingClose(params);
  if (lossCooldown.blocked) return lossCooldown;
  return blockedByRecentStopChurn(params);
}
