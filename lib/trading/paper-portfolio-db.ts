import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import type { DemoWorkspaceOwnerType } from "@/lib/supabase-demo";
import {
  mapTradeRowToDemo,
  mergeDemoTradesById,
} from "@/lib/trading/paper-trade-db-map";
import { resolvePaperTradesUserId } from "@/lib/trading/paper-trades-sync";
import type { PaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import { resolvePaperScalpWalletUsd } from "@/lib/trading/paper-scalp-wallet";
import type { DemoAccount } from "@/lib/types";

export type PaperPortfolioDbMetrics = {
  sessionBaselineUsdt: number;
  nav24hAgoUsdt: number | null;
  nav7dAgoUsdt: number | null;
  lifetimeRealizedPnlUsdt: number;
  closedTradeCount: number;
};

const TRADE_LOAD_LIMIT = 200;
const MS_24H = 24 * 60 * 60 * 1000;
const MS_7D = 7 * MS_24H;

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export type PaperWorkspaceDbCtx = {
  userId: string;
  workspaceKey: string;
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
  metrics: PaperPortfolioDbMetrics | null;
};

export async function loadPaperWorkspaceDbContext(params: {
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
  workspaceKey: string;
}): Promise<PaperWorkspaceDbCtx | null> {
  const userId = resolvePaperTradesUserId(params.ownerType, params.ownerId);
  if (!userId || !isSupabaseAdminConfigured || !supabaseAdmin) return null;

  const [baseline, metrics] = await Promise.all([
    loadWorkspaceBaseline(params.workspaceKey),
    loadPaperPortfolioMetrics({
      userId,
      workspaceKey: params.workspaceKey,
    }),
  ]);

  const sessionBaselineUsdt =
    baseline?.starting_balance_usdt ?? metrics?.sessionBaselineUsdt ?? resolvePaperScalpWalletUsd();

  return {
    userId,
    workspaceKey: params.workspaceKey,
    ownerType: params.ownerType,
    ownerId: params.ownerId,
    metrics: metrics
      ? { ...metrics, sessionBaselineUsdt }
      : {
          sessionBaselineUsdt,
          nav24hAgoUsdt: null,
          nav7dAgoUsdt: null,
          lifetimeRealizedPnlUsdt: 0,
          closedTradeCount: 0,
        },
  };
}

async function loadWorkspaceBaseline(
  workspaceKey: string,
): Promise<{ starting_balance_usdt: number } | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("paper_workspace_baselines")
    .select("starting_balance_usdt")
    .eq("workspace_key", workspaceKey)
    .maybeSingle();
  if (error) {
    console.warn("[paper-portfolio-db] baseline load failed", {
      workspaceKey,
      message: error.message,
    });
    return null;
  }
  if (!data) return null;
  return { starting_balance_usdt: num(data.starting_balance_usdt) };
}

export async function ensurePaperWorkspaceBaseline(params: {
  ctx: PaperWorkspaceDbCtx;
  account: DemoAccount;
}): Promise<number> {
  if (!supabaseAdmin) return params.account.startingBalance;

  const floor = resolvePaperScalpWalletUsd();
  const starting = num(
    params.account.startingBalance > 0
      ? params.account.startingBalance
      : params.ctx.metrics?.sessionBaselineUsdt ?? floor,
    floor,
  );

  const { error } = await supabaseAdmin.from("paper_workspace_baselines").upsert(
    {
      workspace_key: params.ctx.workspaceKey,
      user_id: params.ctx.userId,
      owner_type: params.ctx.ownerType,
      owner_id: params.ctx.ownerId,
      starting_balance_usdt: starting,
      wallet_floor_usdt: floor,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_key", ignoreDuplicates: false },
  );

  if (error) {
    console.warn("[paper-portfolio-db] baseline upsert failed", {
      workspaceKey: params.ctx.workspaceKey,
      message: error.message,
    });
  }
  return starting;
}

export async function loadPaperTradesForWorkspace(
  userId: string,
  workspaceKey: string,
): Promise<{ open: DemoAccount["openPositions"]; closed: DemoAccount["tradeHistory"] }> {
  if (!supabaseAdmin) return { open: [], closed: [] };

  const { data, error } = await supabaseAdmin
    .from("trades")
    .select("*")
    .eq("user_id", userId)
    .eq("extra->>workspace_key", workspaceKey)
    .eq("extra->>paper_scalp", "true")
    .order("opened_at", { ascending: false })
    .limit(TRADE_LOAD_LIMIT);

  if (error) {
    console.warn("[paper-portfolio-db] trades load failed", {
      workspaceKey,
      message: error.message,
    });
    return { open: [], closed: [] };
  }

  const open: DemoAccount["openPositions"] = [];
  const closed: DemoAccount["tradeHistory"] = [];

  for (const row of data ?? []) {
    const trade = mapTradeRowToDemo(row as Record<string, unknown>);
    if (!trade) continue;
    if (trade.status === "open") open.push(trade);
    else closed.push(trade);
  }

  return { open, closed };
}

export async function mergePaperAccountFromDatabase(params: {
  account: DemoAccount;
  ctx: PaperWorkspaceDbCtx | null;
}): Promise<DemoAccount> {
  if (!params.ctx) return params.account;

  const { open, closed } = await loadPaperTradesForWorkspace(
    params.ctx.userId,
    params.ctx.workspaceKey,
  );

  const baseline =
    params.ctx.metrics?.sessionBaselineUsdt ??
    (await ensurePaperWorkspaceBaseline({ ctx: params.ctx, account: params.account }));

  const tradeHistory = mergeDemoTradesById(
    params.account.tradeHistory,
    closed,
  ).slice(0, TRADE_LOAD_LIMIT);

  const openPositions = mergeDemoTradesById(
    params.account.openPositions,
    open,
  ).filter((t) => t.status === "open");

  return {
    ...params.account,
    startingBalance: baseline,
    openPositions,
    tradeHistory,
  };
}

export async function loadPaperPortfolioMetrics(params: {
  userId: string;
  workspaceKey: string;
}): Promise<PaperPortfolioDbMetrics | null> {
  if (!supabaseAdmin) return null;

  const now = Date.now();
  const at24h = new Date(now - MS_24H).toISOString();
  const at7d = new Date(now - MS_7D).toISOString();

  const [snap24, snap7, tradesRes, baseline] = await Promise.all([
    loadNavSnapshotAtOrBefore(params.workspaceKey, at24h),
    loadNavSnapshotAtOrBefore(params.workspaceKey, at7d),
    supabaseAdmin
      .from("trades")
      .select("pnl,status")
      .eq("user_id", params.userId)
      .eq("extra->>workspace_key", params.workspaceKey)
      .eq("extra->>paper_scalp", "true")
      .in("status", ["closed", "stopped"]),
    loadWorkspaceBaseline(params.workspaceKey),
  ]);

  let lifetimeRealizedPnlUsdt = 0;
  let closedTradeCount = 0;
  if (!tradesRes.error) {
    for (const row of tradesRes.data ?? []) {
      lifetimeRealizedPnlUsdt += num(row.pnl);
      closedTradeCount += 1;
    }
  }

  lifetimeRealizedPnlUsdt = Number(lifetimeRealizedPnlUsdt.toFixed(4));

  return {
    sessionBaselineUsdt: num(
      baseline?.starting_balance_usdt,
      resolvePaperScalpWalletUsd(),
    ),
    nav24hAgoUsdt: snap24,
    nav7dAgoUsdt: snap7,
    lifetimeRealizedPnlUsdt,
    closedTradeCount,
  };
}

async function loadNavSnapshotAtOrBefore(
  workspaceKey: string,
  isoBefore: string,
): Promise<number | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("paper_portfolio_snapshots")
    .select("total_nav_usdt")
    .eq("workspace_key", workspaceKey)
    .lte("recorded_at", isoBefore)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const nav = num(data.total_nav_usdt);
  return nav > 0 ? nav : null;
}

export async function recordPaperPortfolioSnapshot(params: {
  ctx: PaperWorkspaceDbCtx;
  nav: PaperWorkspaceNav;
  openLegCount: number;
}): Promise<void> {
  if (!supabaseAdmin) return;

  const { error } = await supabaseAdmin.from("paper_portfolio_snapshots").insert([
    {
      user_id: params.ctx.userId,
      workspace_key: params.ctx.workspaceKey,
      owner_type: params.ctx.ownerType,
      owner_id: params.ctx.ownerId,
      free_cash_usdt: params.nav.available_usdt,
      open_legs_value_usdt: params.nav.open_positions_usdt,
      total_nav_usdt: params.nav.portfolio_nav_usdt,
      open_leg_count: params.openLegCount,
      session_baseline_usdt: params.nav.starting_usdt,
      lifetime_realized_pnl_usdt: params.nav.lifetime_realized_pnl_usdt ?? 0,
    },
  ]);

  if (error) {
    console.warn("[paper-portfolio-db] snapshot insert failed", {
      workspaceKey: params.ctx.workspaceKey,
      message: error.message,
    });
  }
}

export function enrichNavWithDbMetrics(
  nav: PaperWorkspaceNav,
  metrics: PaperPortfolioDbMetrics | null,
): PaperWorkspaceNav {
  if (!metrics) return nav;

  const starting_usdt = Number(metrics.sessionBaselineUsdt.toFixed(4));
  const session_pnl_usdt = Number(
    (nav.portfolio_nav_usdt - starting_usdt).toFixed(4),
  );
  const session_pnl_pct =
    starting_usdt > 0
      ? Number(((session_pnl_usdt / starting_usdt) * 100).toFixed(4))
      : 0;

  const pnl_24h_usdt =
    metrics.nav24hAgoUsdt != null
      ? Number((nav.portfolio_nav_usdt - metrics.nav24hAgoUsdt).toFixed(4))
      : null;
  const pnl_7d_usdt =
    metrics.nav7dAgoUsdt != null
      ? Number((nav.portfolio_nav_usdt - metrics.nav7dAgoUsdt).toFixed(4))
      : null;

  return {
    ...nav,
    starting_usdt,
    session_pnl_usdt,
    session_pnl_pct,
    pnl_24h_usdt,
    pnl_7d_usdt,
    lifetime_realized_pnl_usdt: metrics.lifetimeRealizedPnlUsdt,
    closed_trade_count: metrics.closedTradeCount,
  };
}
