import { resolvePaperLiveMarkPrice } from "@/lib/trading/paper-scalp-mark-price";
import { resolvePaperLegSide } from "@/lib/trading/paper-scalp-leg-side";
import type { PaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import type { CoinData, DemoAccount, DemoTrade } from "@/lib/types";

export type PaperSnapshotOpenLeg = {
  symbol: string;
  side: string;
  entry_price: number;
  qty: number;
  mark_price: number;
  value_usdt: number;
  unrealized_pnl_usdt: number;
  trail_sl: number | null;
  opened_at: string;
  leg_id: string;
};

export type PaperSnapshotDetails = {
  engine_mode: string;
  session_baseline_usdt: number;
  lifetime_realized_pnl_usdt: number;
  closed_trade_count: number;
  open_legs: PaperSnapshotOpenLeg[];
  actions: string[];
  workspace_summaries: string[];
  loss_note: string | null;
};

export type PaperSnapshotTickMeta = {
  workspaceKey: string;
  tickSummary: string;
  regimeLabel: string;
  actions: string[];
  workspaceSummaries?: string[];
  engineMode?: string;
};

function legUnrealizedPnl(leg: DemoTrade, mark: number): number {
  if (leg.type === "buy") {
    return Number(((mark - leg.entryPrice) * leg.amount).toFixed(4));
  }
  return Number(((leg.entryPrice - mark) * leg.amount).toFixed(4));
}

export function buildOpenLegSnapshots(
  account: DemoAccount,
  marketCoins: CoinData[],
): PaperSnapshotOpenLeg[] {
  return account.openPositions.map((leg) => {
    const mark = resolvePaperLiveMarkPrice(
      leg.symbol,
      marketCoins,
      leg.entryPrice,
    );
    const value = Number((leg.amount * mark).toFixed(4));
    return {
      symbol: leg.symbol,
      side: resolvePaperLegSide(leg),
      entry_price: Number(leg.entryPrice.toFixed(8)),
      qty: Number(leg.amount.toFixed(8)),
      mark_price: Number(mark.toFixed(8)),
      value_usdt: value,
      unrealized_pnl_usdt: legUnrealizedPnl(leg, mark),
      trail_sl: leg.stopLoss ?? null,
      opened_at:
        leg.openedAt instanceof Date
          ? leg.openedAt.toISOString()
          : String(leg.openedAt),
      leg_id: leg.id,
    };
  });
}

function buildLossNote(
  nav: PaperWorkspaceNav,
  legs: PaperSnapshotOpenLeg[],
): string | null {
  if (nav.session_pnl_usdt >= 0) return null;
  if (legs.length === 0) {
    return "Session underwater with no open legs — check baseline vs cash reconcile.";
  }
  const worst = [...legs].sort(
    (a, b) => a.unrealized_pnl_usdt - b.unrealized_pnl_usdt,
  )[0];
  return `Open ${worst.symbol} ${worst.side} mark ${worst.mark_price} vs entry ${worst.entry_price} → ${worst.unrealized_pnl_usdt} USDT unrealized.`;
}

export function buildPaperSnapshotDetails(params: {
  account: DemoAccount;
  nav: PaperWorkspaceNav;
  marketCoins: CoinData[];
  meta: PaperSnapshotTickMeta;
}): PaperSnapshotDetails {
  const open_legs = buildOpenLegSnapshots(
    params.account,
    params.marketCoins,
  );
  return {
    engine_mode: params.meta.engineMode ?? "micro",
    session_baseline_usdt: Number(params.nav.starting_usdt.toFixed(4)),
    lifetime_realized_pnl_usdt: Number(
      (params.nav.lifetime_realized_pnl_usdt ?? 0).toFixed(4),
    ),
    closed_trade_count: params.nav.closed_trade_count ?? 0,
    open_legs,
    actions: params.meta.actions,
    workspace_summaries: params.meta.workspaceSummaries ?? [],
    loss_note: buildLossNote(params.nav, open_legs),
  };
}
