import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { coerceNavUsdtForSnapshot } from "@/lib/trading/paper-nav-sanitize";
import {
  buildPaperSnapshotDetails,
  type PaperSnapshotTickMeta,
} from "@/lib/trading/paper-snapshot-payload";
import { resolvePaperScalpWalletUsd } from "@/lib/trading/paper-scalp-wallet";
import type { PaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import type { PaperWorkspaceDbCtx } from "@/lib/trading/paper-portfolio-db";
import type { CoinData, DemoAccount } from "@/lib/types";

export const PAPER_SNAPSHOT_MODULE_TAG = "paper-snapshot-v5-details";

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveSnapshotNavUsdt(nav: PaperWorkspaceNav): number {
  const wallet = resolvePaperScalpWalletUsd();
  const coerced = coerceNavUsdtForSnapshot(nav);
  const n = Number(coerced);
  if (Number.isFinite(n) && n >= 0) return Number(n.toFixed(4));
  return wallet;
}

export type RecordPaperSnapshotParams = {
  ctx: PaperWorkspaceDbCtx;
  nav: PaperWorkspaceNav;
  account: DemoAccount;
  marketCoins: CoinData[];
  meta: PaperSnapshotTickMeta;
};

/**
 * One NAV row per tick with leg/regime context for later review.
 */
export async function recordPaperPortfolioSnapshot(
  params: RecordPaperSnapshotParams,
): Promise<void> {
  if (String(process.env.PAPER_SNAPSHOTS ?? "1").trim() === "0") return;
  if (!isSupabaseAdminConfigured || !supabaseAdmin) return;

  const portfolio_nav_usdt = resolveSnapshotNavUsdt(params.nav);
  const details = buildPaperSnapshotDetails({
    account: params.account,
    nav: params.nav,
    marketCoins: params.marketCoins,
    meta: params.meta,
  });

  const row = {
    user_id: params.ctx.userId,
    workspace_key: params.meta.workspaceKey || params.ctx.workspaceKey,
    portfolio_nav_usdt,
    free_cash_usdt: num(params.nav.available_usdt),
    open_legs_value_usdt: num(params.nav.open_positions_usdt),
    session_pnl_usdt: num(params.nav.session_pnl_usdt),
    session_pnl_pct: num(params.nav.session_pnl_pct),
    open_leg_count: params.account.openPositions.length,
    tick_summary: params.meta.tickSummary.slice(0, 500),
    regime_label: params.meta.regimeLabel.slice(0, 120),
    details,
    recorded_at: new Date().toISOString(),
  };

  let { error } = await supabaseAdmin
    .from("paper_portfolio_snapshots")
    .insert([row]);

  if (error?.message?.includes("Could not find")) {
    const slim = {
      user_id: params.ctx.userId,
      portfolio_nav_usdt,
      recorded_at: row.recorded_at,
    };
    const retry = await supabaseAdmin
      .from("paper_portfolio_snapshots")
      .insert([slim]);
    error = retry.error;
  }

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
