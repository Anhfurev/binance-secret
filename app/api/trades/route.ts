import { NextResponse } from "next/server";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

const TRADE_SELECT =
  "id,symbol,type,status,price,entryPrice,exitPrice,amount,value,opened_at,closed_at,pnl,pnlPercent,exchange_order_id,notes,extra,stopLoss,takeProfit,followedSignal,created_at";

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatTradeRow(row: Record<string, unknown>) {
  const entry = toNum(row.entryPrice) ?? toNum(row.price) ?? 0;
  const exit = toNum(row.exitPrice);
  const amount = toNum(row.amount) ?? 0;
  const value = toNum(row.value);
  const pnl = toNum(row.pnl);
  const extra = (row.extra ?? {}) as Record<string, unknown>;
  const status = String(row.status ?? "").toLowerCase();
  const isOpen = status === "open";

  return {
    id: row.id,
    symbol: row.symbol,
    type: row.type,
    status: row.status,
    tradeMode: extra.trade_mode ?? null,
    exchangeOrderId: row.exchange_order_id ?? null,
    boughtAt: row.opened_at ?? row.created_at,
    closedAt: isOpen ? null : row.closed_at,
    entryPrice: entry,
    exitPrice: exit,
    amount,
    costUsdt: value ?? (entry > 0 && amount > 0 ? Number((entry * amount).toFixed(8)) : null),
    pnlUsdt: pnl,
    pnlPercent: toNum(row.pnlPercent),
    stopLoss: toNum(row.stopLoss),
    takeProfit: toNum(row.takeProfit),
    notes: row.notes ?? null,
    isOpen,
  };
}

export async function GET(req: Request) {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return NextResponse.json(
      { ok: false, error: "Supabase admin not configured", open: [], closed: [], summary: null },
      { status: 200 },
    );
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId")?.trim();
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));
  const liveOnly = url.searchParams.get("liveOnly") === "1";

  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "userId query param required", open: [], closed: [], summary: null },
      { status: 400 },
    );
  }

  let query = supabaseAdmin
    .from("trades")
    .select(TRADE_SELECT)
    .eq("user_id", userId)
    .order("opened_at", { ascending: false })
    .limit(limit);

  if (liveOnly) {
    query = query.eq("extra->>trade_mode", "live");
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message, open: [], closed: [], summary: null },
      { status: 200 },
    );
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const formatted = rows.map(formatTradeRow);
  const open = formatted.filter((t) => t.isOpen);
  const closed = formatted.filter((t) => !t.isOpen);
  const realizedPnl = closed.reduce((s, t) => s + (t.pnlUsdt ?? 0), 0);

  return NextResponse.json({
    ok: true,
    summary: {
      totalReturned: formatted.length,
      openCount: open.length,
      closedCount: closed.length,
      realizedPnlUsdt: Number(realizedPnl.toFixed(4)),
      openCostUsdt: Number(
        open.reduce((s, t) => s + (t.costUsdt ?? 0), 0).toFixed(4),
      ),
    },
    open,
    closed,
  });
}
