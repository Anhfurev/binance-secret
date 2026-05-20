import { isSupabaseAdminConfigured } from "@/lib/supabase-admin";
import type { DemoWorkspaceOwnerType } from "@/lib/supabase-demo";
import { resolvePaperLegSide } from "@/lib/trading/paper-scalp-leg-side";
import {
  computeTradeCloseEconomics,
} from "@/lib/trading/paper-trade-economics";
import {
  logPaperDbBinding,
  safeUpsertClosedTradeRow,
} from "@/lib/trading/paper-trades-db-safe";
import type { DemoAccount, DemoTrade } from "@/lib/types";

const HISTORY_SYNC_LIMIT = 40;

function normalizeSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

function toIso(value: Date | string | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function extractExitReason(trade: DemoTrade): string {
  const notes = trade.notes ?? "";
  const match = notes.match(/exit:([^\s|]+)/i);
  if (match?.[1]) return match[1];
  const tag = trade.tags?.find((t) => t.includes("trail") || t.includes("exit"));
  return tag ?? "paper-scalp";
}

/** Canonical profiles.id for all paper DB rows — device + user workspaces share one wallet. */
export function resolvePaperTradesUserId(
  ownerType: DemoWorkspaceOwnerType,
  ownerId: string,
): string | null {
  const mapped = String(process.env.PAPER_TRADES_USER_ID ?? "").trim();
  if (mapped.length > 0) return mapped;
  if (ownerType === "user" && ownerId.trim().length > 0) return ownerId.trim();
  return null;
}

function buildUnifiedClosedRow(params: {
  trade: DemoTrade;
  userId: string;
}): Record<string, unknown> | null {
  const { trade, userId } = params;
  if (trade.status === "open") return null;

  const exitPrice =
    trade.exitPrice != null && trade.exitPrice > 0
      ? trade.exitPrice
      : trade.entryPrice;
  if (exitPrice <= 0 || trade.entryPrice <= 0) return null;

  const closedAt = toIso(trade.closedAt) ?? new Date().toISOString();
  const isLong = trade.type === "buy";
  const economics = computeTradeCloseEconomics({
    entryPrice: trade.entryPrice,
    exitPrice,
    amount: trade.amount,
    notionalUsdt: trade.value,
    isLong,
    signalEntryPrice: trade.originalEntryPrice ?? trade.entryPrice,
    signalExitPrice: exitPrice,
  });
  const fees = economics.entryFeeUsdt + economics.exitFeeUsdt;
  const netPnl =
    trade.pnl != null && Number.isFinite(trade.pnl)
      ? Number(trade.pnl)
      : economics.netPnlUsdt;

  return {
    user_id: userId,
    symbol: normalizeSymbol(trade.symbol),
    side: resolvePaperLegSide(trade),
    entry_price: trade.entryPrice,
    exit_price: exitPrice,
    qty: trade.amount,
    raw_pnl: Number(economics.rawPnlUsdt.toFixed(4)),
    fees: Number(fees.toFixed(4)),
    net_pnl: Number(netPnl.toFixed(4)),
    strategy_executed: `${trade.id}|${extractExitReason(trade)}`,
    closed_at: closedAt,
  };
}

function buildLegacyClosedRow(params: {
  trade: DemoTrade;
  userId: string;
  workspaceKey: string;
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
}): Record<string, unknown> | null {
  const { trade, userId, workspaceKey, ownerType, ownerId } = params;
  if (trade.status === "open") return null;

  const exitPrice =
    trade.exitPrice != null && trade.exitPrice > 0
      ? trade.exitPrice
      : trade.entryPrice;
  if (exitPrice <= 0 || trade.entryPrice <= 0) return null;

  const side = resolvePaperLegSide(trade);
  const status =
    trade.status === "stopped" ? "stopped" : "closed";
  const exitReason = extractExitReason(trade);

  return {
    user_id: userId,
    signalId: trade.signalId,
    exchange_order_id: `paper-${trade.id}`,
    coinId: trade.coinId,
    symbol: normalizeSymbol(trade.symbol),
    type: trade.type,
    entryPrice: trade.entryPrice,
    exitPrice,
    amount: trade.amount,
    value: trade.value,
    status,
    pnl: trade.pnl ?? null,
    pnlPercent: trade.pnlPercent ?? null,
    opened_at: toIso(trade.openedAt) ?? new Date().toISOString(),
    closed_at: toIso(trade.closedAt) ?? new Date().toISOString(),
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    followedSignal: trade.followedSignal ?? false,
    exit_reason: exitReason,
    notes: trade.notes ?? null,
    extra: {
      paper_leg_id: trade.id,
      workspace_key: workspaceKey,
      owner_type: ownerType,
      owner_id: ownerId,
      trade_mode: "paper",
      is_paper: true,
      paper_scalp: true,
      direction: side,
    },
  };
}

/**
 * Mirror closed paper-scalp legs into public.trades (open legs live in paper_positions).
 */
export async function syncPaperAccountTrades(params: {
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
  workspaceKey: string;
  account: DemoAccount;
}): Promise<{ synced: number; skipped: boolean }> {
  logPaperDbBinding();
  if (!isSupabaseAdminConfigured) {
    return { synced: 0, skipped: true };
  }

  const userId = resolvePaperTradesUserId(params.ownerType, params.ownerId);
  if (!userId) {
    return { synced: 0, skipped: true };
  }

  let synced = 0;
  const seen = new Set<string>();

  const pushTrade = async (trade: DemoTrade) => {
    if (seen.has(trade.id)) return;
    seen.add(trade.id);
    const unified = buildUnifiedClosedRow({ trade, userId });
    const legacy = buildLegacyClosedRow({
      trade,
      userId,
      workspaceKey: params.workspaceKey,
      ownerType: params.ownerType,
      ownerId: params.ownerId,
    });
    if (!unified || !legacy) return;
    if (await safeUpsertClosedTradeRow(unified, legacy)) synced += 1;
  };

  const history = params.account.tradeHistory.slice(0, HISTORY_SYNC_LIMIT);
  for (const leg of history) {
    await pushTrade(leg);
  }

  if (synced > 0) {
    console.log(
      `[paper-trades-sync] ${params.workspaceKey} synced=${synced} closed=${history.length}`,
    );
  }

  return { synced, skipped: false };
}

/** Persist one closed leg immediately (e.g. micro trailing stop). */
export async function syncPaperTradeImmediately(params: {
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
  workspaceKey: string;
  trade: DemoTrade;
}): Promise<boolean> {
  logPaperDbBinding();
  if (!isSupabaseAdminConfigured) return false;
  const userId = resolvePaperTradesUserId(params.ownerType, params.ownerId);
  if (!userId) return false;

  const unified = buildUnifiedClosedRow({ trade: params.trade, userId });
  const legacy = buildLegacyClosedRow({
    trade: params.trade,
    userId,
    workspaceKey: params.workspaceKey,
    ownerType: params.ownerType,
    ownerId: params.ownerId,
  });
  if (!unified || !legacy) return false;

  const ok = await safeUpsertClosedTradeRow(unified, legacy);
  if (ok) {
    console.log(
      `[paper-trades-sync] closed ${params.trade.symbol} net=${params.trade.pnl ?? 0} leg=${params.trade.id}`,
    );
  }
  return ok;
}

export function queuePaperTradesSync(params: {
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
  workspaceKey: string;
  account: DemoAccount;
}): void {
  void syncPaperAccountTrades(params).catch((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[paper-trades-sync] async failed", {
      workspaceKey: params.workspaceKey,
      message: err.message,
    });
  });
}
