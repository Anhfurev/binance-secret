import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import type { DemoAccount } from "@/lib/types";

const MS_24H = 24 * 60 * 60 * 1000;

export function readMicroMaxDrawdownPct(): number {
  const n = Number(String(process.env.MICRO_MAX_DRAWDOWN_PCT ?? "8").trim());
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 8;
}

async function navSnapshotAtOrBefore24h(
  userId: string,
): Promise<number | null> {
  if (!supabaseAdmin) return null;
  const cutoff = new Date(Date.now() - MS_24H).toISOString();
  const { data, error } = await supabaseAdmin
    .from("paper_portfolio_snapshots")
    .select("portfolio_nav_usdt,recorded_at")
    .eq("user_id", userId)
    .lte("recorded_at", cutoff)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[micro-drawdown] paper_portfolio_snapshots lookup failed", {
      userId,
      message: error.message,
    });
    return null;
  }
  if (!data) return null;
  const nav = Number(data.portfolio_nav_usdt);
  return Number.isFinite(nav) && nav > 0 ? nav : null;
}

export type DrawdownPauseState = {
  paused: boolean;
  dropPct: number;
  baselineNav: number | null;
};

export async function evaluate24hDrawdownPause(params: {
  userId: string | null;
  currentNavUsdt: number;
}): Promise<DrawdownPauseState> {
  if (!params.userId || !isSupabaseAdminConfigured) {
    return { paused: false, dropPct: 0, baselineNav: null };
  }

  const baselineNav = await navSnapshotAtOrBefore24h(params.userId);
  if (baselineNav == null) {
    return { paused: false, dropPct: 0, baselineNav: null };
  }

  const dropPct = Number(
    (
      ((baselineNav - params.currentNavUsdt) / baselineNav) *
      100
    ).toFixed(4),
  );

  return {
    paused: dropPct >= readMicroMaxDrawdownPct(),
    dropPct,
    baselineNav,
  };
}

export async function checkMicroDrawdownCircuit(params: {
  userId: string | null;
  currentNavUsdt: number;
}): Promise<boolean> {
  const state = await evaluate24hDrawdownPause(params);
  return state.paused;
}

export function applyDrawdownPauseAccount(
  account: DemoAccount,
  pause: DrawdownPauseState,
): DemoAccount {
  if (!pause.paused) return account;
  return { ...account, circuitBreakerTripped: true };
}
