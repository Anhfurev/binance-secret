import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { coerceNavUsdtForSnapshot } from "@/lib/trading/paper-nav-sanitize";
import { resolvePaperScalpWalletUsd } from "@/lib/trading/paper-scalp-wallet";
import type { PaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import type { PaperWorkspaceDbCtx } from "@/lib/trading/paper-portfolio-db";

export const PAPER_SNAPSHOT_MODULE_TAG = "paper-snapshot-v4-slim";

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Always a finite positive number for Postgres numeric NOT NULL. */
function resolveSnapshotNavUsdt(nav: PaperWorkspaceNav): number {
  const wallet = resolvePaperScalpWalletUsd();
  const coerced = coerceNavUsdtForSnapshot(nav);
  const n = Number(coerced);
  if (Number.isFinite(n) && n >= 0) return Number(n.toFixed(4));
  return wallet;
}

/**
 * One NAV row per tick — prod table columns only:
 * user_id, portfolio_nav_usdt, recorded_at
 */
export async function recordPaperPortfolioSnapshot(params: {
  ctx: PaperWorkspaceDbCtx;
  nav: PaperWorkspaceNav;
  openLegCount?: number;
}): Promise<void> {
  void params.openLegCount;
  if (String(process.env.PAPER_SNAPSHOTS ?? "1").trim() === "0") return;
  if (!isSupabaseAdminConfigured || !supabaseAdmin) return;

  const portfolio_nav_usdt = resolveSnapshotNavUsdt(params.nav);
  const row = {
    user_id: params.ctx.userId,
    portfolio_nav_usdt,
    recorded_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("paper_portfolio_snapshots")
    .insert([row]);

  if (error && process.env.PAPER_DEBUG === "1") {
    console.log(`[${PAPER_SNAPSHOT_MODULE_TAG}] insert skipped`, {
      userId: params.ctx.userId,
      portfolio_nav_usdt,
      message: error.message,
    });
  }
}

export async function loadNavSnapshotAtOrBefore(
  userId: string,
  isoBefore: string,
): Promise<number | null> {
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin
    .from("paper_portfolio_snapshots")
    .select("portfolio_nav_usdt")
    .eq("user_id", userId)
    .lte("recorded_at", isoBefore)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const nav = num(data.portfolio_nav_usdt);
  return nav > 0 ? nav : null;
}
