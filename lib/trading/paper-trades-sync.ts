import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import type { DemoWorkspaceOwnerType } from "@/lib/supabase-demo";
import { resolvePaperLegSide } from "@/lib/trading/paper-scalp-leg-side";
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

function resolvePrice(trade: DemoTrade): number {
  const candidates = [
    trade.exitPrice,
    trade.entryPrice,
    trade.highestPriceReached,
    trade.lowestPriceReached,
  ];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c) && c > 0) return c;
  }
  return 0;
}

function extractExitReason(trade: DemoTrade): string | null {
  const notes = trade.notes ?? "";
  const match = notes.match(/exit:([^\s|]+)/i);
  if (match?.[1]) return match[1];
  const tag = trade.tags?.find((t) => t.includes("atr") || t.includes("exit"));
  return tag ?? null;
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

function buildTradesRow(params: {
  trade: DemoTrade;
  userId: string;
  workspaceKey: string;
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
}): Record<string, unknown> | null {
  const { trade, userId, workspaceKey, ownerType, ownerId } = params;
  const price = resolvePrice(trade);
  if (price <= 0) return null;

  const side = resolvePaperLegSide(trade);
  const status =
    trade.status === "open"
      ? "open"
      : trade.status === "stopped"
        ? "stopped"
        : "closed";

  const exitReason = status !== "open" ? extractExitReason(trade) : null;

  return {
    user_id: userId,
    signalId: trade.signalId,
    exchange_order_id: `paper-${trade.id}`,
    coinId: trade.coinId,
    symbol: normalizeSymbol(trade.symbol),
    type: trade.type,
    price,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice ?? null,
    amount: trade.amount,
    value: trade.value,
    status,
    pnl: trade.pnl ?? null,
    pnlPercent: trade.pnlPercent ?? null,
    opened_at: toIso(trade.openedAt) ?? new Date().toISOString(),
    closed_at: toIso(trade.closedAt),
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
      margin_used_usdt: trade.marginUsed ?? trade.value,
      leverage: trade.leverage ?? 1,
      profit_loss_usdt: trade.pnl ?? null,
      highest_price_reached: trade.highestPriceReached ?? null,
      lowest_price_reached: trade.lowestPriceReached ?? null,
      velocity_tp_secured: trade.velocityTakeProfitSecured ?? false,
      pyramid_layers: trade.pyramidLayers ?? 0,
      tags: trade.tags ?? [],
    },
  };
}

async function findTradeRowId(
  userId: string,
  paperLegId: string,
): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("trades")
    .select("id")
    .eq("user_id", userId)
    .eq("extra->>paper_leg_id", paperLegId)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[paper-trades-sync] lookup failed", { paperLegId, error: error.message });
    return null;
  }
  return typeof data?.id === "string" ? data.id : null;
}

async function upsertPaperTradeRow(row: Record<string, unknown>): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const userId = String(row.user_id);
  const paperLegId = String((row.extra as Record<string, unknown>)?.paper_leg_id ?? "");
  if (!paperLegId) return false;

  const existingId = await findTradeRowId(userId, paperLegId);
  if (existingId) {
    const { error } = await supabaseAdmin
      .from("trades")
      .update(row)
      .eq("id", existingId);
    if (error) {
      console.warn("[paper-trades-sync] update failed", {
        paperLegId,
        error: error.message,
      });
      return false;
    }
    return true;
  }

  const { error } = await supabaseAdmin.from("trades").insert([row]);
  if (error) {
    console.warn("[paper-trades-sync] insert failed", {
      paperLegId,
      error: error.message,
    });
    return false;
  }
  return true;
}

/**
 * Mirror paper-scalp legs into public.trades for dashboards / audits.
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

  const ctx = {
    userId,
    workspaceKey: params.workspaceKey,
    ownerType: params.ownerType,
    ownerId: params.ownerId,
  };

  let synced = 0;
  const seen = new Set<string>();

  const pushTrade = async (trade: DemoTrade) => {
    if (seen.has(trade.id)) return;
    seen.add(trade.id);
    const row = buildTradesRow({ trade, ...ctx });
    if (!row) return;
    if (await upsertPaperTradeRow(row)) synced += 1;
  };

  for (const leg of params.account.openPositions) {
    await pushTrade(leg);
  }

  const history = params.account.tradeHistory.slice(0, HISTORY_SYNC_LIMIT);
  for (const leg of history) {
    await pushTrade(leg);
  }

  if (synced > 0) {
    console.log(
      `[paper-trades-sync] ${params.workspaceKey} synced=${synced} open=${params.account.openPositions.length}`,
    );
  }

  return { synced, skipped: false };
}

/** Persist one leg immediately (e.g. ATR trailing stop close). */
export async function syncPaperTradeImmediately(params: {
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
  workspaceKey: string;
  trade: DemoTrade;
}): Promise<boolean> {
  if (!isSupabaseAdminConfigured) return false;
  const userId = resolvePaperTradesUserId(params.ownerType, params.ownerId);
  if (!userId) return false;

  const row = buildTradesRow({
    trade: params.trade,
    userId,
    workspaceKey: params.workspaceKey,
    ownerType: params.ownerType,
    ownerId: params.ownerId,
  });
  if (!row) return false;

  const ok = await upsertPaperTradeRow(row);
  if (ok) {
    console.log(
      `[paper-trades-sync] closed ${params.trade.symbol} pnl=${params.trade.pnl ?? 0} leg=${params.trade.id}`,
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
