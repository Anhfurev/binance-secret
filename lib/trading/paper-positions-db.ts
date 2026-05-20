import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import type { DemoWorkspaceOwnerType } from "@/lib/supabase-demo";
import { resolvePaperTradesUserId } from "@/lib/trading/paper-trades-sync";
import type { DemoTrade } from "@/lib/types";

export type PaperPositionRow = {
  id: string;
  paper_leg_id: string;
  symbol: string;
  side: string;
  entry_price: number;
  amount: number;
  value_usdt: number;
  peak_price: number;
  stop_loss: number;
  trail_armed: boolean;
  status: string;
};

function num(v: unknown, fb = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function mapRow(raw: Record<string, unknown>): PaperPositionRow {
  return {
    id: String(raw.id),
    paper_leg_id: String(raw.paper_leg_id),
    symbol: String(raw.symbol),
    side: String(raw.side ?? "LONG"),
    entry_price: num(raw.entry_price),
    amount: num(raw.amount),
    value_usdt: num(raw.value_usdt),
    peak_price: num(raw.peak_price),
    stop_loss: num(raw.stop_loss),
    trail_armed: raw.trail_armed === true,
    status: String(raw.status ?? "open"),
  };
}

export async function loadOpenPaperPositions(
  workspaceKey: string,
): Promise<PaperPositionRow[]> {
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin
    .from("paper_positions")
    .select(
      "id,paper_leg_id,symbol,side,entry_price,amount,value_usdt,peak_price,stop_loss,trail_armed,status",
    )
    .eq("workspace_key", workspaceKey)
    .eq("status", "open");
  if (error) {
    console.warn("[paper_positions] load open failed", {
      workspaceKey,
      message: error.message,
    });
    return [];
  }
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function upsertOpenPaperPosition(params: {
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
  workspaceKey: string;
  trade: DemoTrade;
}): Promise<void> {
  if (!supabaseAdmin) return;
  const userId = resolvePaperTradesUserId(params.ownerType, params.ownerId);
  if (!userId) return;

  const peak = trade.highestPriceReached ?? trade.entryPrice;
  const { error } = await supabaseAdmin.from("paper_positions").upsert(
    {
      user_id: userId,
      workspace_key: params.workspaceKey,
      owner_type: params.ownerType,
      owner_id: params.ownerId,
      paper_leg_id: trade.id,
      symbol: trade.symbol,
      side: trade.direction ?? "LONG",
      entry_price: trade.entryPrice,
      amount: trade.amount,
      value_usdt: trade.value,
      peak_price: peak,
      stop_loss: trade.stopLoss,
      trail_armed: false,
      status: "open",
      opened_at: trade.openedAt.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_key,paper_leg_id" },
  );
  if (error) {
    console.warn("[paper_positions] upsert failed", {
      leg: trade.id,
      message: error.message,
    });
  }
}

export async function updatePaperPositionTrail(params: {
  id: string;
  peak_price: number;
  stop_loss: number;
  trail_armed: boolean;
}): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin
    .from("paper_positions")
    .update({
      peak_price: params.peak_price,
      stop_loss: params.stop_loss,
      trail_armed: params.trail_armed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id);
}

export async function closePaperPositionRow(
  id: string,
  reason: string,
): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin
    .from("paper_positions")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      extra: { exit_reason: reason },
    })
    .eq("id", id);
}

export function demoTradeFromPositionRow(row: PaperPositionRow): DemoTrade {
  return {
    id: row.paper_leg_id,
    signalId: "micro-acceleration",
    coinId: row.symbol.replace("USDT", ""),
    symbol: row.symbol,
    type: "buy",
    direction: row.side === "SHORT" ? "SHORT" : "LONG",
    entryPrice: row.entry_price,
    amount: row.amount,
    value: row.value_usdt,
    status: "open",
    stopLoss: row.stop_loss,
    takeProfit: row.entry_price * 1.5,
    highestPriceReached: row.peak_price,
    openedAt: new Date(),
    followedSignal: false,
    tags: ["micro-scalp"],
  };
}

export async function syncOpenPositionsToDb(params: {
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
  workspaceKey: string;
  openTrades: DemoTrade[];
}): Promise<void> {
  for (const trade of params.openTrades) {
    await upsertOpenPaperPosition({ ...params, trade });
  }
}
