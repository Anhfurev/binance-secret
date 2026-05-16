// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { toNumber } from "./utils.ts";

export function readPaperWalletReconcileEnabled(): boolean {
  const raw = String(Deno.env.get("PAPER_WALLET_RECONCILE") ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no";
}

export function readPaperWalletReconcileToleranceUsd(): number {
  const n = Number(String(Deno.env.get("PAPER_WALLET_RECONCILE_TOLERANCE_USD") ?? "0.5").trim());
  if (!Number.isFinite(n) || n < 0) return 0.5;
  return Math.min(50, n);
}

function isPaperNonGhostTrade(extra: Record<string, unknown> | null | undefined): boolean {
  if (!extra || typeof extra !== "object") return false;
  if (String(extra.is_ghost ?? "").toLowerCase() === "true") return false;
  const mode = String(extra.trade_mode ?? "").toLowerCase();
  if (mode === "paper") return true;
  return String(extra.is_paper ?? "").toLowerCase() === "true";
}

/** Cash = starting + realized PnL − capital locked in open paper legs. */
export function computeExpectedPaperDemoBalance(
  startingBalance: number,
  trades: Array<{
    status?: string | null;
    pnl?: number | string | null;
    value?: number | string | null;
    extra?: Record<string, unknown> | null;
  }>,
): number {
  const starting = toNumber(startingBalance, 0);
  let realized = 0;
  let openLocked = 0;
  for (const row of trades) {
    if (!isPaperNonGhostTrade(row.extra ?? null)) continue;
    const status = String(row.status ?? "").toLowerCase();
    if (status === "open") {
      const extra = row.extra ?? null;
      realized += toNumber(extra?.realized_pnl_usd, 0);
      openLocked += toNumber(row.value, 0);
      continue;
    }
    if (status === "closed" || status === "stopped") {
      realized += toNumber(row.pnl, 0);
    }
  }
  return Number((starting + realized - openLocked).toFixed(2));
}

export async function reconcilePaperDemoBalanceForUser(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<{
  applied: boolean;
  expected: number;
  actual: number;
  delta: number;
}> {
  const profileRes = await supabase
    .from("profiles")
    .select("demo_balance,starting_balance")
    .eq("id", userId)
    .maybeSingle();
  if (profileRes.error) throw profileRes.error;
  const profile = profileRes.data as {
    demo_balance?: number;
    starting_balance?: number;
  } | null;
  if (!profile) {
    return { applied: false, expected: 0, actual: 0, delta: 0 };
  }

  const tradesRes = await supabase
    .from("trades")
    .select("status,pnl,value,extra")
    .eq("user_id", userId)
    .limit(5000);
  if (tradesRes.error) throw tradesRes.error;

  const starting = toNumber(profile.starting_balance, toNumber(profile.demo_balance, 0));
  const expected = computeExpectedPaperDemoBalance(
    starting,
    (tradesRes.data ?? []) as Array<{
      status?: string;
      pnl?: number;
      value?: number;
      extra?: Record<string, unknown>;
    }>,
  );
  const actual = toNumber(profile.demo_balance, expected);
  const delta = Number((expected - actual).toFixed(2));
  const tolerance = readPaperWalletReconcileToleranceUsd();
  if (Math.abs(delta) < tolerance) {
    return { applied: false, expected, actual, delta };
  }

  const patch = await supabase
    .from("profiles")
    .update({
      demo_balance: expected,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (patch.error) throw patch.error;
  return { applied: true, expected, actual, delta };
}

export async function reconcilePaperProfilesForUserIds(
  supabase: ReturnType<typeof createClient>,
  userIds: Iterable<string>,
): Promise<{ checked: number; rebased: number }> {
  const unique = [...new Set([...userIds].filter(Boolean))];
  let rebased = 0;
  for (const userId of unique) {
    try {
      const result = await reconcilePaperDemoBalanceForUser(supabase, userId);
      if (result.applied) rebased += 1;
    } catch {
      // Best-effort per profile — cron must not fail on one bad row.
    }
  }
  return { checked: unique.length, rebased };
}
