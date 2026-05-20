import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import type { DemoWorkspaceOwnerType } from "@/lib/supabase-demo";
import { resolvePaperTradesUserId } from "@/lib/trading/paper-trades-sync";
import type { DemoTrade } from "@/lib/types";

export type PaperPositionRow = {
  id: string;
  user_id: string;
  symbol: string;
  side: string;
  entry_price: number;
  qty: number;
  peak_price: number;
  trail_price: number;
  layer: number;
  opened_at: string;
};

function num(v: unknown, fb = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function normSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

function readMicroTrailArmPct(): number {
  const n = Number(String(process.env.MICRO_TRAIL_ARM_PCT ?? "1.5").trim());
  return Number.isFinite(n) && n > 0 ? n : 1.5;
}

export function isPaperPositionTrailArmed(row: PaperPositionRow): boolean {
  const arm = readMicroTrailArmPct() / 100;
  return row.peak_price > row.entry_price * (1 + arm);
}

function mapRow(raw: Record<string, unknown>): PaperPositionRow {
  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    symbol: normSymbol(String(raw.symbol)),
    side: String(raw.side ?? "LONG"),
    entry_price: num(raw.entry_price),
    qty: num(raw.qty),
    peak_price: num(raw.peak_price),
    trail_price: num(raw.trail_price),
    layer: Math.max(0, Math.floor(num(raw.layer))),
    opened_at: String(raw.opened_at ?? new Date().toISOString()),
  };
}

export async function loadOpenPaperPositions(
  userId: string,
): Promise<PaperPositionRow[]> {
  if (!supabaseAdmin || !userId) return [];
  const { data, error } = await supabaseAdmin
    .from("paper_positions")
    .select(
      "id,user_id,symbol,side,entry_price,qty,peak_price,trail_price,layer,opened_at",
    )
    .eq("user_id", userId);
  if (error) {
    console.warn("[paper_positions] load open failed", {
      userId,
      message: error.message,
    });
    return [];
  }
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function upsertOpenPaperPosition(params: {
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
  trade: DemoTrade;
}): Promise<void> {
  if (!supabaseAdmin) return;
  const userId = resolvePaperTradesUserId(params.ownerType, params.ownerId);
  if (!userId) return;

  const symbol = normSymbol(params.trade.symbol);
  const peak = params.trade.highestPriceReached ?? params.trade.entryPrice;
  const trail = params.trade.stopLoss ?? params.trade.entryPrice;

  await supabaseAdmin
    .from("paper_positions")
    .delete()
    .eq("user_id", userId)
    .eq("symbol", symbol);

  const { error } = await supabaseAdmin.from("paper_positions").insert([
    {
      user_id: userId,
      symbol,
      side: params.trade.direction ?? "LONG",
      entry_price: params.trade.entryPrice,
      qty: params.trade.amount,
      peak_price: peak,
      trail_price: trail,
      layer: params.trade.pyramidLayers ?? 0,
      opened_at: params.trade.openedAt.toISOString(),
    },
  ]);

  if (error) {
    console.warn("[paper_positions] insert failed", {
      leg: params.trade.id,
      symbol,
      message: error.message,
    });
  }
}

export async function updatePaperPositionTrail(params: {
  id: string;
  peak_price: number;
  trail_price: number;
}): Promise<void> {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin
    .from("paper_positions")
    .update({
      peak_price: params.peak_price,
      trail_price: params.trail_price,
    })
    .eq("id", params.id);
  if (error) {
    console.warn("[paper_positions] trail update failed", {
      id: params.id,
      message: error.message,
    });
  }
}

export async function closePaperPositionRow(id: string): Promise<void> {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin
    .from("paper_positions")
    .delete()
    .eq("id", id);
  if (error) {
    console.warn("[paper_positions] delete failed", {
      id,
      message: error.message,
    });
  }
}

export function demoTradeFromPositionRow(row: PaperPositionRow): DemoTrade {
  const isShort = row.side === "SHORT";
  const value = row.qty * row.entry_price;
  return {
    id: row.id,
    signalId: "micro-acceleration",
    coinId: row.symbol.replace("USDT", ""),
    symbol: row.symbol,
    type: isShort ? "sell" : "buy",
    direction: isShort ? "SHORT" : "LONG",
    entryPrice: row.entry_price,
    amount: row.qty,
    value,
    status: "open",
    stopLoss: row.trail_price,
    takeProfit: row.entry_price * 1.5,
    highestPriceReached: row.peak_price,
    openedAt: new Date(row.opened_at),
    followedSignal: false,
    pyramidLayers: row.layer,
    tags: ["micro-scalp"],
  };
}

export function matchOpenLegToPositionRow(
  openPositions: DemoTrade[],
  row: PaperPositionRow,
): DemoTrade | undefined {
  const sym = normSymbol(row.symbol);
  return openPositions.find((p) => {
    if (normSymbol(p.symbol) !== sym) return false;
    const ep = p.entryPrice;
    return Math.abs(ep - row.entry_price) / Math.max(row.entry_price, 1e-9) < 0.002;
  });
}

export async function syncOpenPositionsToDb(params: {
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
  openTrades: DemoTrade[];
}): Promise<void> {
  if (!isSupabaseAdminConfigured) return;
  for (const trade of params.openTrades) {
    await upsertOpenPaperPosition({
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      trade,
    });
  }
}
