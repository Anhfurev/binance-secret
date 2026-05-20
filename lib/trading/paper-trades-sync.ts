import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import type { DemoWorkspaceOwnerType } from "@/lib/supabase-demo";
import { resolvePaperLegSide } from "@/lib/trading/paper-scalp-leg-side";
import {
  computeTradeCloseEconomics,
} from "@/lib/trading/paper-trade-economics";
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

/** `trades.user_id` must be auth.users — device workspaces use PAPER_TRADES_USER_ID. */
export function resolvePaperTradesUserId(
  ownerType: DemoWorkspaceOwnerType,
  ownerId: string,
): string | null {
  if (ownerType === "user") return ownerId;
  const mapped = String(process.env.PAPER_TRADES_USER_ID ?? "").trim();
  return mapped.length > 0 ? mapped : null;
}

function buildClosedTradeRow(params: {
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

async function findClosedTradeRowId(
  userId: string,
  strategyKey: string,
): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("trades")
    .select("id")
    .eq("user_id", userId)
    .eq("strategy_executed", strategyKey)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[paper-trades-sync] lookup failed", {
      strategyKey,
      error: error.message,
    });
    return null;
  }
  return typeof data?.id === "string" ? data.id : null;
}

async function upsertClosedTradeRow(row: Record<string, unknown>): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const userId = String(row.user_id);
  const strategyKey = String(row.strategy_executed ?? "");
  if (!strategyKey) return false;

  const existingId = await findClosedTradeRowId(userId, strategyKey);
  if (existingId) {
    const { error } = await supabaseAdmin
      .from("trades")
      .update(row)
      .eq("id", existingId);
    if (error) {
      console.warn("[paper-trades-sync] update failed", {
        strategyKey,
        error: error.message,
      });
      return false;
    }
    return true;
  }

  const { error } = await supabaseAdmin.from("trades").insert([row]);
  if (error) {
    console.warn("[paper-trades-sync] insert failed", {
      strategyKey,
      error: error.message,
    });
    return false;
  }
  return true;
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
    const row = buildClosedTradeRow({ trade, userId });
    if (!row) return;
    if (await upsertClosedTradeRow(row)) synced += 1;
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
  if (!isSupabaseAdminConfigured) return false;
  const userId = resolvePaperTradesUserId(params.ownerType, params.ownerId);
  if (!userId) return false;

  const row = buildClosedTradeRow({ trade: params.trade, userId });
  if (!row) return false;

  const ok = await upsertClosedTradeRow(row);
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
    console.warn("[paper-trades-sync] async failed", {
      workspaceKey: params.workspaceKey,
      message: err.message,
    });
  });
}
