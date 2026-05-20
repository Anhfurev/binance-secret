import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import type { DemoWorkspaceOwnerType } from "@/lib/supabase-demo";
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

type SnapshotInsertRow = Record<string, unknown>;

function safeNavUsdt(nav: PaperWorkspaceNav): number {
  const v = Number(coerceNavUsdtForSnapshot(nav));
  if (Number.isFinite(v) && v >= 0) return Number(v.toFixed(4));
  return resolvePaperScalpWalletUsd();
}

function finalizeSnapshotRow(row: SnapshotInsertRow): SnapshotInsertRow {
  const nav = safeNavUsdt({
    portfolio_nav_usdt: num(row.portfolio_nav_usdt),
    available_usdt: num(row.free_cash_usdt),
    open_positions_usdt: num(row.open_legs_value_usdt),
    starting_usdt: resolvePaperScalpWalletUsd(),
    session_pnl_usdt: 0,
    session_pnl_pct: 0,
    open_unrealized_pnl_usdt: 0,
  } as PaperWorkspaceNav);
  return {
    ...row,
    portfolio_nav_usdt: nav,
    total_nav_usdt: num(row.total_nav_usdt) > 0 ? num(row.total_nav_usdt) : nav,
  };
}

function buildUnifiedRow(
  userId: string,
  nav: PaperWorkspaceNav,
): SnapshotInsertRow {
  return finalizeSnapshotRow({
    user_id: userId,
    portfolio_nav_usdt: safeNavUsdt(nav),
    recorded_at: new Date().toISOString(),
  });
}

function buildLegacyRow(
  ctx: PaperWorkspaceDbCtx,
  nav: PaperWorkspaceNav,
  openLegCount: number,
): SnapshotInsertRow {
  const clean = sanitizePaperWorkspaceNav(nav);
  const navVal = safeNavUsdt(clean);
  return finalizeSnapshotRow({
    user_id: ctx.userId,
    workspace_key: ctx.workspaceKey,
    owner_type: ctx.ownerType,
    owner_id: ctx.ownerId,
    recorded_at: new Date().toISOString(),
    free_cash_usdt: clean.available_usdt,
    open_legs_value_usdt: clean.open_positions_usdt,
    total_nav_usdt: navVal,
    portfolio_nav_usdt: navVal,
    open_leg_count: openLegCount,
    session_baseline_usdt: clean.starting_usdt,
    lifetime_realized_pnl_usdt: clean.lifetime_realized_pnl_usdt ?? 0,
    extra: {},
  });
}

async function insertSnapshotRow(row: SnapshotInsertRow): Promise<string | null> {
  if (!supabaseAdmin) return "no admin client";
  const payload = finalizeSnapshotRow(row);
  const { error } = await supabaseAdmin
    .from("paper_portfolio_snapshots")
    .insert([payload]);
  return error?.message ?? null;
}

function isLegacySchemaError(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes("could not find") && m.includes("portfolio_nav_usdt")) return true;
  if (m.includes("does not exist") && m.includes("portfolio_nav_usdt")) return true;
  if (m.includes("workspace_key") && m.includes("not-null")) return true;
  if (m.includes("total_nav_usdt") && m.includes("not-null")) return true;
  if (m.includes("free_cash_usdt") && m.includes("not-null")) return true;
  if (m.includes("portfolio_nav_usdt") && m.includes("not-null")) return true;
  if (m.includes("owner_type") && m.includes("not-null")) return true;
  return false;
}

/**
 * One NAV point per tick — supports slim (portfolio_nav_usdt) and legacy
 * (total_nav_usdt + workspace_key) snapshot tables.
 */
export async function recordPaperPortfolioSnapshot(params: {
  ctx: PaperWorkspaceDbCtx;
  nav: PaperWorkspaceNav;
  openLegCount?: number;
}): Promise<void> {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) return;

  const openLegCount = params.openLegCount ?? 0;
  const unified = buildUnifiedRow(params.ctx.userId, params.nav);
  let errMsg = await insertSnapshotRow(unified);

  if (!errMsg) return;

  if (isLegacySchemaError(errMsg)) {
    const legacy = buildLegacyRow(params.ctx, params.nav, openLegCount);
    errMsg = await insertSnapshotRow(legacy);
    if (!errMsg) return;
  }

  console.warn("[paper-portfolio-db] snapshot insert failed", {
    userId: params.ctx.userId,
    message: errMsg,
  });
}

/** Read historical NAV — portfolio_nav_usdt or legacy total_nav_usdt. */
export async function loadNavSnapshotAtOrBefore(
  userId: string,
  isoBefore: string,
): Promise<number | null> {
  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("paper_portfolio_snapshots")
      .select("portfolio_nav_usdt,total_nav_usdt")
      .eq("user_id", userId)
      .lte("recorded_at", isoBefore)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const nav =
      num(data.portfolio_nav_usdt) || num((data as { total_nav_usdt?: number }).total_nav_usdt);
    return nav > 0 ? nav : null;
  } catch {
    return null;
  }
}
