import { isSupabaseAdminConfigured } from "@/lib/supabase-admin";
import type { DemoWorkspaceOwnerType } from "@/lib/supabase-demo";
import { resolvePaperTradesUserId } from "@/lib/trading/paper-db-user";
import { resolvePaperLegSide } from "@/lib/trading/paper-scalp-leg-side";
import {
  computeTradeCloseEconomics,
} from "@/lib/trading/paper-trade-economics";
import {
  buildPaperStrategyKey,
  truncateDbText,
} from "@/lib/trading/paper-trades-db-text";
import {
  logPaperDbBinding,
  safeUpsertClosedTradeRow,
} from "@/lib/trading/paper-trades-db-safe";
import type { DemoAccount, DemoTrade } from "@/lib/types";

export { resolvePaperTradesUserId } from "@/lib/trading/paper-db-user";

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
  const exitReason = extractExitReason(trade);

  return {
    user_id: userId,
    symbol: truncateDbText(normalizeSymbol(trade.symbol)),
    side: truncateDbText(resolvePaperLegSide(trade), 16),
    entry_price: trade.entryPrice,
    exit_price: exitPrice,
    qty: trade.amount,
    raw_pnl: Number(economics.rawPnlUsdt.toFixed(4)),
    fees: Number(fees.toFixed(4)),
    net_pnl: Number(netPnl.toFixed(4)),
    strategy_executed: buildPaperStrategyKey(trade.id, exitReason),
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
  const status = trade.status === "stopped" ? "stopped" : "closed";
  const exitReason = extractExitReason(trade);
  const exchangeOrderId = truncateDbText(`paper-${trade.id.slice(0, 32)}`);

  return {
    user_id: userId,
    signalId: truncateDbText(trade.signalId),
    exchange_order_id: exchangeOrderId,
    coinId: truncateDbText(trade.coinId),
    symbol: truncateDbText(normalizeSymbol(trade.symbol)),
    type: truncateDbText(trade.type, 16),
    entryPrice: trade.entryPrice,
    exitPrice,
    amount: trade.amount,
    value: trade.value,
    status: truncateDbText(status, 16),
    pnl: trade.pnl ?? null,
    pnlPercent: trade.pnlPercent ?? null,
    opened_at: toIso(trade.openedAt) ?? new Date().toISOString(),
    closed_at: toIso(trade.closedAt) ?? new Date().toISOString(),
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    followedSignal: trade.followedSignal ?? false,
    exit_reason: truncateDbText(exitReason),
    notes: truncateDbText(trade.notes, 500),
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
