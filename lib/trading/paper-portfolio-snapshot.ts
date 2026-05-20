import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import {
  coerceNavUsdtForSnapshot,
  sanitizePaperWorkspaceNav,
} from "@/lib/trading/paper-nav-sanitize";
import { resolvePaperScalpWalletUsd } from "@/lib/trading/paper-scalp-wallet";
import type { PaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import type { PaperWorkspaceDbCtx } from "@/lib/trading/paper-portfolio-db";

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Slim prod schema: user_id + portfolio_nav_usdt + recorded_at only. */
function buildSlimInsertRow(userId: string, nav: PaperWorkspaceNav) {
  const navVal = coerceNavUsdtForSnapshot(nav);
  return {
    user_id: userId,
    portfolio_nav_usdt: navVal,
    recorded_at: new Date().toISOString(),
  };
}

/** Legacy schema: workspace_key + total_nav_usdt (no portfolio_nav_usdt column). */
function buildLegacyInsertRow(
  ctx: PaperWorkspaceDbCtx,
  nav: PaperWorkspaceNav,
  openLegCount: number,
) {
  const clean = sanitizePaperWorkspaceNav(nav);
  const navVal = coerceNavUsdtForSnapshot(clean);
  return {
    user_id: ctx.userId,
    workspace_key: ctx.workspaceKey,
    owner_type: ctx.ownerType,
    owner_id: ctx.ownerId,
    recorded_at: new Date().toISOString(),
    free_cash_usdt: clean.available_usdt,
    open_legs_value_usdt: clean.open_positions_usdt,
    total_nav_usdt: navVal,
    open_leg_count: openLegCount,
    session_baseline_usdt: clean.starting_usdt,
    lifetime_realized_pnl_usdt: clean.lifetime_realized_pnl_usdt ?? 0,
    extra: {},
  };
}

function isMissingColumnError(message: string, column: string): boolean {
  const m = message.toLowerCase();
  const col = column.toLowerCase();
  return (
    (m.includes("could not find") && m.includes(col)) ||
    (m.includes("does not exist") && m.includes(col))
  );
}

function needsLegacyRow(message: string): boolean {
  const m = message.toLowerCase();
  if (isMissingColumnError(message, "portfolio_nav_usdt")) return true;
  if (m.includes("workspace_key") && m.includes("not-null")) return true;
  if (m.includes("total_nav_usdt") && m.includes("not-null")) return true;
  if (m.includes("free_cash_usdt") && m.includes("not-null")) return true;
  if (m.includes("owner_type") && m.includes("not-null")) return true;
  return false;
}

/**
 * One NAV point per tick — slim schema first, legacy fallback only when required.
 */
export async function recordPaperPortfolioSnapshot(params: {
  ctx: PaperWorkspaceDbCtx;
  nav: PaperWorkspaceNav;
  openLegCount?: number;
}): Promise<void> {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) return;

  const openLegCount = params.openLegCount ?? 0;
  const slim = buildSlimInsertRow(params.ctx.userId, params.nav);

  let { error } = await supabaseAdmin
    .from("paper_portfolio_snapshots")
    .insert([slim]);

  if (!error) return;

  let errMsg = error.message;

  if (isMissingColumnError(errMsg, "total_nav_usdt")) {
    console.warn(
      "[paper-portfolio-db] snapshot retry — dropped unknown column from payload",
      { userId: params.ctx.userId },
    );
    const { error: retryErr } = await supabaseAdmin
      .from("paper_portfolio_snapshots")
      .insert([slim]);
    if (!retryErr) return;
    errMsg = retryErr.message;
  }

  if (needsLegacyRow(errMsg)) {
    const legacy = buildLegacyInsertRow(params.ctx, params.nav, openLegCount);
    const legacyRes = await supabaseAdmin
      .from("paper_portfolio_snapshots")
      .insert([legacy]);
    if (!legacyRes.error) return;
    errMsg = legacyRes.error.message;
  }

  console.warn("[paper-portfolio-db] snapshot insert failed", {
    userId: params.ctx.userId,
    message: errMsg,
  });
}

/** Read historical NAV — tries slim column, then legacy total_nav_usdt. */
export async function loadNavSnapshotAtOrBefore(
  userId: string,
  isoBefore: string,
): Promise<number | null> {
  if (!supabaseAdmin) return null;

  const slim = await supabaseAdmin
    .from("paper_portfolio_snapshots")
    .select("portfolio_nav_usdt")
    .eq("user_id", userId)
    .lte("recorded_at", isoBefore)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!slim.error && slim.data) {
    const nav = num(slim.data.portfolio_nav_usdt);
    if (nav > 0) return nav;
  }

  if (
    slim.error &&
    !isMissingColumnError(slim.error.message, "portfolio_nav_usdt")
  ) {
    return null;
  }

  const legacy = await supabaseAdmin
    .from("paper_portfolio_snapshots")
    .select("total_nav_usdt")
    .eq("user_id", userId)
    .lte("recorded_at", isoBefore)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (legacy.error || !legacy.data) return null;
  const nav = num(legacy.data.total_nav_usdt);
  return nav > 0 ? nav : null;
}
