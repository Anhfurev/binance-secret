import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import type { DemoWorkspaceOwnerType } from "@/lib/supabase-demo";
import {
  demoTradeFromPositionRow,
  loadOpenPaperPositions,
} from "@/lib/trading/paper-positions-db";
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

export function resolvePaperSessionBaseline(
  account: DemoAccount,
  fallbackNav?: number | null,
): number {
  if (account.startingBalance > 0) return account.startingBalance;
  if (fallbackNav != null && fallbackNav > 0) return fallbackNav;
  return resolvePaperScalpWalletUsd();
}

/** Legacy hook — session baseline is in-memory / profiles; no separate baseline table. */
export async function ensurePaperWorkspaceBaseline(params: {
  ctx: PaperWorkspaceDbCtx;
  account: DemoAccount;
}): Promise<number> {
  return resolvePaperSessionBaseline(
    params.account,
    params.ctx.metrics?.sessionBaselineUsdt,
  );
}

export async function loadPaperWorkspaceDbContext(params: {
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
  workspaceKey: string;
}): Promise<PaperWorkspaceDbCtx | null> {
  const userId = resolvePaperTradesUserId(params.ownerType, params.ownerId);
  if (!userId || !isSupabaseAdminConfigured || !supabaseAdmin) return null;

  const metrics = await loadPaperPortfolioMetrics({ userId });

  const sessionBaselineUsdt = resolvePaperSessionBaseline(
    { startingBalance: 0 } as DemoAccount,
    metrics?.sessionBaselineUsdt,
  );

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

export async function loadPaperTradesForWorkspace(
  userId: string,
): Promise<{ open: DemoAccount["openPositions"]; closed: DemoAccount["tradeHistory"] }> {
  if (!supabaseAdmin) return { open: [], closed: [] };

  const [positionRows, tradesRes] = await Promise.all([
    loadOpenPaperPositions(userId),
    supabaseAdmin
      .from("trades")
      .select(
        "id,user_id,symbol,side,entry_price,exit_price,qty,raw_pnl,fees,net_pnl,strategy_executed,closed_at",
      )
      .eq("user_id", userId)
      .not("closed_at", "is", null)
      .order("closed_at", { ascending: false })
      .limit(TRADE_LOAD_LIMIT),
  ]);

  const open = positionRows.map((row) => demoTradeFromPositionRow(row));
  const closed: DemoAccount["tradeHistory"] = [];

  if (tradesRes.error) {
    console.warn("[paper-portfolio-db] trades load failed", {
      userId,
      message: tradesRes.error.message,
    });
  } else {
    for (const row of tradesRes.data ?? []) {
      const trade = mapTradeRowToDemo(row as Record<string, unknown>);
      if (trade) closed.push(trade);
    }
  }

  return { open, closed };
}

export async function mergePaperAccountFromDatabase(params: {
  account: DemoAccount;
  ctx: PaperWorkspaceDbCtx | null;
}): Promise<DemoAccount> {
  if (!params.ctx) return params.account;

  const { open, closed } = await loadPaperTradesForWorkspace(params.ctx.userId);

  const baseline = await ensurePaperWorkspaceBaseline({
    ctx: params.ctx,
    account: params.account,
  });

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
}): Promise<PaperPortfolioDbMetrics | null> {
  if (!supabaseAdmin) return null;

  const now = Date.now();
  const at24h = new Date(now - MS_24H).toISOString();
  const at7d = new Date(now - MS_7D).toISOString();

  const [snap24, snap7, tradesRes, profileRes] = await Promise.all([
    loadNavSnapshotAtOrBefore(params.userId, at24h),
    loadNavSnapshotAtOrBefore(params.userId, at7d),
    supabaseAdmin
      .from("trades")
      .select("net_pnl")
      .eq("user_id", params.userId)
      .not("closed_at", "is", null),
    supabaseAdmin
      .from("profiles")
      .select("demo_balance,portfolio_nav_usdt")
      .eq("id", params.userId)
      .maybeSingle(),
  ]);

  let lifetimeRealizedPnlUsdt = 0;
  let closedTradeCount = 0;
  if (!tradesRes.error) {
    for (const row of tradesRes.data ?? []) {
      lifetimeRealizedPnlUsdt += num(row.net_pnl);
      closedTradeCount += 1;
    }
  }

  const profileNav = num(
    profileRes.data?.portfolio_nav_usdt,
    num(profileRes.data?.demo_balance),
  );

  return {
    sessionBaselineUsdt: resolvePaperSessionBaseline(
      { startingBalance: 0 } as DemoAccount,
      profileNav > 0 ? profileNav : null,
    ),
    nav24hAgoUsdt: snap24,
    nav7dAgoUsdt: snap7,
    lifetimeRealizedPnlUsdt: Number(lifetimeRealizedPnlUsdt.toFixed(4)),
    closedTradeCount,
  };
}

async function loadNavSnapshotAtOrBefore(
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

export async function recordPaperPortfolioSnapshot(params: {
  ctx: PaperWorkspaceDbCtx;
  nav: PaperWorkspaceNav;
}): Promise<void> {
  if (!supabaseAdmin) return;

  const { error } = await supabaseAdmin.from("paper_portfolio_snapshots").insert([
    {
      user_id: params.ctx.userId,
      portfolio_nav_usdt: params.nav.portfolio_nav_usdt,
      recorded_at: new Date().toISOString(),
    },
  ]);

  if (error) {
    console.warn("[paper-portfolio-db] snapshot insert failed", {
      userId: params.ctx.userId,
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
