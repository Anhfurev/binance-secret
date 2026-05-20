/**
 * Paper portfolio DB — profiles, snapshots, paper_positions only.
 * ALL public.trades access goes through @/lib/trading/paper-trades-db-safe.
 */
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import type { DemoWorkspaceOwnerType } from "@/lib/supabase-demo";
import {
  demoTradeFromPositionRow,
  loadOpenPaperPositions,
  type PaperPositionRow,
} from "@/lib/trading/paper-positions-db";
import {
  mapTradeRowToDemo,
  mergeDemoTradesById,
} from "@/lib/trading/paper-trade-db-map";
import { resolvePaperTradesUserId } from "@/lib/trading/paper-db-user";
import {
  getPaperTradesSchemaMode,
  logPaperDbBinding,
  safeFetchPaperClosedTrades,
  safeFetchTradesPnlAggregate,
} from "@/lib/trading/paper-trades-db-safe";
import { normalizePaperWorkspaceAccount } from "@/lib/trading/paper-cash-reconcile";
import type { PaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import { resolvePaperScalpWalletUsd } from "@/lib/trading/paper-scalp-wallet";
import type { DemoAccount, DemoTrade } from "@/lib/types";

function normSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

function refreshLegFromDbRow(leg: DemoTrade, row: PaperPositionRow): DemoTrade {
  const value = row.qty * row.entry_price;
  return {
    ...leg,
    entryPrice: row.entry_price,
    amount: row.qty,
    value,
    stopLoss: row.trail_price,
    highestPriceReached: row.peak_price,
    pyramidLayers: row.layer,
  };
}

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

/** Closed history via paper-trades-db-safe (never queries trades.side / entry_price here). */
export async function loadPaperTradesForWorkspace(
  userId: string,
): Promise<{ open: DemoAccount["openPositions"]; closed: DemoAccount["tradeHistory"] }> {
  logPaperDbBinding();
  if (!isSupabaseAdminConfigured || !userId) {
    return { open: [], closed: [] };
  }

  try {
    const positionRows = await loadOpenPaperPositions(userId).catch(
      (error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error("[paper-portfolio-db] paper_positions load exception", {
          userId: `${userId.slice(0, 8)}…`,
          message: err.message,
        });
        return [];
      },
    );

    const tradeRows = await safeFetchPaperClosedTrades(userId, TRADE_LOAD_LIMIT);

    const open = positionRows.map((row) => demoTradeFromPositionRow(row));
    const closed: DemoAccount["tradeHistory"] = [];

    for (const row of tradeRows) {
      const trade = mapTradeRowToDemo(row);
      if (trade) closed.push(trade);
    }

    return { open, closed };
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[paper-portfolio-db] loadPaperTradesForWorkspace exception", {
      userId: `${userId.slice(0, 8)}…`,
      tradesSchema: getPaperTradesSchemaMode(),
      message: err.message,
    });
    return { open: [], closed: [] };
  }
}

export async function mergePaperAccountFromDatabase(params: {
  account: DemoAccount;
  ctx: PaperWorkspaceDbCtx | null;
}): Promise<DemoAccount> {
  if (!params.ctx) return params.account;

  let open: DemoAccount["openPositions"] = [];
  let closed: DemoAccount["tradeHistory"] = [];
  try {
    const loaded = await loadPaperTradesForWorkspace(params.ctx.userId);
    open = loaded.open;
    closed = loaded.closed;
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[paper-portfolio-db] mergePaperAccountFromDatabase failed", {
      userId: `${params.ctx.userId.slice(0, 8)}…`,
      message: err.message,
    });
    return params.account;
  }

  const baseline = await ensurePaperWorkspaceBaseline({
    ctx: params.ctx,
    account: params.account,
  });

  const tradeHistory = mergeDemoTradesById(
    params.account.tradeHistory,
    closed,
  ).slice(0, TRADE_LOAD_LIMIT);

  const dbBySymbol = new Map(
    open.map((row) => [normSymbol(row.symbol), row] as const),
  );

  let openPositions: DemoTrade[];
  if (params.account.openPositions.length > 0) {
    openPositions = params.account.openPositions.map((leg) => {
      const row = dbBySymbol.get(normSymbol(leg.symbol));
      return row ? refreshLegFromDbRow(leg, row) : leg;
    });
  } else {
    openPositions = open.filter((t) => t.status === "open");
  }

  return normalizePaperWorkspaceAccount({
    ...params.account,
    startingBalance: baseline,
    openPositions,
    tradeHistory,
  });
}

export async function loadPaperPortfolioMetrics(params: {
  userId: string;
}): Promise<PaperPortfolioDbMetrics | null> {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) return null;

  logPaperDbBinding();

  const now = Date.now();
  const at24h = new Date(now - MS_24H).toISOString();
  const at7d = new Date(now - MS_7D).toISOString();

  let profileStarting = 0;
  try {
    const res = await supabaseAdmin
      .from("profiles")
      .select("starting_balance,demo_balance")
      .eq("id", params.userId)
      .maybeSingle();
    if (res.error) {
      console.warn("[paper-portfolio-db] profiles load failed", {
        message: res.error.message,
      });
    } else {
      profileStarting = num(
        res.data?.starting_balance,
        num(res.data?.demo_balance),
      );
    }
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[paper-portfolio-db] profiles load exception", {
      message: err.message,
    });
  }

  const [snap24, snap7, pnlAgg] = await Promise.all([
    loadNavSnapshotAtOrBefore(params.userId, at24h),
    loadNavSnapshotAtOrBefore(params.userId, at7d),
    safeFetchTradesPnlAggregate(params.userId),
  ]);

  const walletTarget = resolvePaperScalpWalletUsd();
  const sessionBaselineUsdt =
    profileStarting > 0 && profileStarting <= walletTarget * 2
      ? profileStarting
      : walletTarget;

  return {
    sessionBaselineUsdt,
    nav24hAgoUsdt: snap24,
    nav7dAgoUsdt: snap7,
    lifetimeRealizedPnlUsdt: pnlAgg.lifetimeRealizedPnlUsdt,
    closedTradeCount: pnlAgg.closedTradeCount,
  };
}

async function loadNavSnapshotAtOrBefore(
  userId: string,
  isoBefore: string,
): Promise<number | null> {
  if (!supabaseAdmin) return null;
  try {
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
  } catch {
    return null;
  }
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
