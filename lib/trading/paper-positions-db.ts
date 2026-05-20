import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import type { DemoWorkspaceOwnerType } from "@/lib/supabase-demo";
import {
  ensurePaperDbUserReady,
  getPaperDbUserId,
  resolvePaperTradesUserId,
} from "@/lib/trading/paper-db-user";
import { isValidPaperOpenLeg } from "@/lib/trading/paper-nav-sanitize";
import { coerceDemoTradeFields } from "@/lib/trading/paper-trade-coerce";
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
  const entry_price =
    num(raw.entry_price) ||
    num(raw.entry_price_usdt) ||
    num(raw.entryPrice);
  const qty =
    num(raw.qty) || num(raw.amount) || num(raw.quantity);
  const peak_price =
    num(raw.peak_price) ||
    num(raw.highest_price) ||
    num(raw.highestPriceReached) ||
    entry_price;
  const trail_price =
    num(raw.trail_price) ||
    num(raw.stop_loss) ||
    num(raw.stopLoss) ||
    entry_price;
  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    symbol: normSymbol(String(raw.symbol)),
    side: String(raw.side ?? "LONG"),
    entry_price,
    qty,
    peak_price,
    trail_price,
    layer: Math.max(0, Math.floor(num(raw.layer) || num(raw.pyramid_layers))),
    opened_at: String(raw.opened_at ?? new Date().toISOString()),
  };
}

export async function loadOpenPaperPositions(
  userId?: string | null,
): Promise<PaperPositionRow[]> {
  const resolved = userId ?? getPaperDbUserId();
  if (!supabaseAdmin || !resolved) return [];
  const { data, error } = await supabaseAdmin
    .from("paper_positions")
    .select(
      "id,user_id,symbol,side,entry_price,qty,peak_price,trail_price,layer,opened_at",
    )
    .eq("user_id", resolved);
  if (error) {
    console.warn("[paper_positions] load open failed", {
      userId: `${resolved.slice(0, 8)}…`,
      message: error.message,
    });
    return [];
  }
  return (data ?? [])
    .map((r) => mapRow(r as Record<string, unknown>))
    .filter((row) => row.entry_price > 0 && row.qty > 0);
}

function coercePositionInsert(trade: DemoTrade): {
  symbol: string;
  side: string;
  entry_price: number;
  qty: number;
  peak_price: number;
  trail_price: number;
  layer: number;
  opened_at: string;
} | null {
  const leg = coerceDemoTradeFields(trade);
  if (!leg || !isValidPaperOpenLeg(leg)) return null;

  const symbol = normSymbol(leg.symbol);
  const entry_price = num(leg.entryPrice);
  const qty = num(leg.amount);
  const peak_price = num(leg.highestPriceReached ?? leg.entryPrice, entry_price);
  const trail_price = num(leg.stopLoss ?? leg.entryPrice, entry_price);
  const opened =
    leg.openedAt instanceof Date ? leg.openedAt : new Date(leg.openedAt);
  if (Number.isNaN(opened.getTime())) return null;

  return {
    symbol,
    side: leg.direction ?? "LONG",
    entry_price,
    qty,
    peak_price,
    trail_price,
    layer: Math.max(0, Math.floor(num(leg.pyramidLayers))),
    opened_at: opened.toISOString(),
  };
}

export async function upsertOpenPaperPosition(params: {
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
  trade: DemoTrade;
}): Promise<void> {
  if (!supabaseAdmin || !isSupabaseAdminConfigured) return;

  if (!(await ensurePaperDbUserReady())) return;

  const userId = getPaperDbUserId();
  if (!userId) return;

  const row = coercePositionInsert(params.trade);
  if (!row) {
    console.warn("[paper_positions] skip insert — invalid leg", {
      userId: `${userId.slice(0, 8)}…`,
      leg: params.trade.id,
      symbol: params.trade.symbol,
      entry: params.trade.entryPrice,
      qty: params.trade.amount,
    });
    return;
  }

  await supabaseAdmin
    .from("paper_positions")
    .delete()
    .eq("user_id", userId)
    .eq("symbol", row.symbol);

  const { error } = await supabaseAdmin.from("paper_positions").insert([
    {
      user_id: userId,
      ...row,
    },
  ]);

  if (error) {
    console.warn("[paper_positions] insert failed", {
      userId: `${userId.slice(0, 8)}…`,
      leg: params.trade.id,
      symbol: row.symbol,
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
  if (!isSupabaseAdminConfigured || !supabaseAdmin) return;
  const userId = getPaperDbUserId();
  if (!userId) return;

  const validSymbols = new Set<string>();
  for (const trade of params.openTrades) {
    const row = coercePositionInsert(trade);
    if (!row) continue;
    validSymbols.add(row.symbol);
    await upsertOpenPaperPosition({
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      trade,
    });
  }

  const existing = await loadOpenPaperPositions(userId);
  for (const row of existing) {
    if (!validSymbols.has(normSymbol(row.symbol))) {
      await closePaperPositionRow(row.id);
    }
  }
}

export { resolvePaperTradesUserId };
