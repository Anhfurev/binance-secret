import { NextResponse } from "next/server";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

type BotPerformanceRow = {
  symbol: string;
  total_trades: number | null;
  win_count: number | null;
  loss_count: number | null;
  total_pnl_usd: number | string | null;
  win_rate_pct: number | string | null;
  updated_at: string | null;
};

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(req: Request) {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return NextResponse.json(
      { ok: false, error: "Supabase admin not configured", summary: null, symbols: [] },
      { status: 200 },
    );
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId")?.trim();

  const query = userId
    ? supabaseAdmin
      .from("bot_performance")
      .select(
        "symbol, total_trades, win_count, loss_count, total_pnl_usd, win_rate_pct, updated_at",
      )
      .eq("user_id", userId)
      .order("symbol", { ascending: true })
    : supabaseAdmin
      .from("bot_performance")
      .select(
        "symbol, total_trades, win_count, loss_count, total_pnl_usd, win_rate_pct, updated_at, user_id",
      )
      .order("updated_at", { ascending: false })
      .limit(12);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message, summary: null, symbols: [] },
      { status: 200 },
    );
  }

  const rows = (data ?? []) as BotPerformanceRow[];
  const totalTrades = rows.reduce((sum, row) => sum + toNumber(row.total_trades), 0);
  const winCount = rows.reduce((sum, row) => sum + toNumber(row.win_count), 0);
  const lossCount = rows.reduce((sum, row) => sum + toNumber(row.loss_count), 0);
  const totalPnlUsd = Number(
    rows.reduce((sum, row) => sum + toNumber(row.total_pnl_usd), 0).toFixed(2),
  );
  const winRatePct = totalTrades > 0
    ? Number(((winCount / totalTrades) * 100).toFixed(2))
    : 0;

  return NextResponse.json({
    ok: true,
    summary: {
      totalTrades,
      winCount,
      lossCount,
      winRatePct,
      totalPnlUsd,
    },
    symbols: rows.map((row) => ({
      symbol: String(row.symbol ?? "UNKNOWN"),
      totalTrades: toNumber(row.total_trades),
      winCount: toNumber(row.win_count),
      lossCount: toNumber(row.loss_count),
      totalPnlUsd: Number(toNumber(row.total_pnl_usd).toFixed(2)),
      winRatePct: Number(toNumber(row.win_rate_pct).toFixed(2)),
      updatedAt: row.updated_at,
    })),
  });
}
