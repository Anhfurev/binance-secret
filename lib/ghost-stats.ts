import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

export type GhostStrategyStats = {
  botId: string;
  closedGhostTrades: number;
  /** Sum of `pnl` on closed SELL rows tagged ghost (realized per round-trip leg). */
  totalPnlUsd: number;
  wins: number;
  losses: number;
};

/**
 * Aggregate closed ghost SELL rows for `extra.bot_id` + `extra.trade_mode === "ghost"`.
 * Use after ~100 cycles to compare vs live bot performance on the same symbol.
 */
export async function getGhostStrategyStats(botId: string): Promise<GhostStrategyStats | null> {
  if (!isSupabaseAdminConfigured || !supabaseAdmin || !botId?.trim()) return null;

  const { data, error } = await supabaseAdmin
    .from("trades")
    .select("pnl, status, type")
    .eq("extra->>bot_id", botId.trim())
    .eq("extra->>trade_mode", "ghost")
    .ilike("type", "sell")
    .in("status", ["closed", "stopped", "CLOSED", "STOPPED"]);

  if (error) {
    console.warn("[ghost-stats] query failed:", error.message);
    return null;
  }

  let totalPnlUsd = 0;
  let wins = 0;
  let losses = 0;
  for (const row of data ?? []) {
    const pnl = typeof (row as { pnl?: unknown }).pnl === "number"
      ? (row as { pnl: number }).pnl
      : Number((row as { pnl?: unknown }).pnl);
    if (!Number.isFinite(pnl)) continue;
    totalPnlUsd += pnl;
    if (pnl > 0) wins += 1;
    else if (pnl < 0) losses += 1;
  }

  return {
    botId: botId.trim(),
    closedGhostTrades: (data ?? []).length,
    totalPnlUsd: Number(totalPnlUsd.toFixed(4)),
    wins,
    losses,
  };
}
