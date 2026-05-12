// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { passesMeanReversionBuyGate } from "./regime-detection.ts";
import type { MarketRegime } from "./types.ts";

function readLookbackMs(): number {
  const raw = String(Deno.env.get("PAPER_LOSS_LESSON_LOOKBACK_HOURS") ?? "12").trim();
  const n = Number(raw);
  const hours = Number.isFinite(n) && n > 0 ? Math.min(72, Math.floor(n)) : 12;
  return hours * 60 * 60 * 1000;
}

export type PaperLossLesson = {
  recentStopLosses: number;
  confidenceBump: number;
  blockBuy: boolean;
  reason: string | null;
};

export async function resolvePaperLossLesson(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  regime: MarketRegime;
  rsi: number;
  latestPrice: number;
  bbLower: number;
}): Promise<PaperLossLesson> {
  const { supabase, userId, symbol, regime, rsi, latestPrice, bbLower } = params;
  const sinceIso = new Date(Date.now() - readLookbackMs()).toISOString();
  const { count, error } = await supabase
    .from("trades")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .in("status", ["closed", "stopped"])
    .eq("exit_reason", "stoploss_hit")
    .gte("closed_at", sinceIso);
  if (error) {
    return { recentStopLosses: 0, confidenceBump: 0, blockBuy: false, reason: null };
  }
  const recentStopLosses = Math.max(0, Number(count ?? 0));
  if (recentStopLosses <= 0) {
    return { recentStopLosses: 0, confidenceBump: 0, blockBuy: false, reason: null };
  }
  const confidenceBump = Math.min(6, recentStopLosses * 2);
  if (recentStopLosses >= 3) {
    const ok = passesMeanReversionBuyGate({ regime, rsi, latestPrice, bbLower });
    if (!ok) {
      return {
        recentStopLosses,
        confidenceBump,
        blockBuy: true,
        reason: "hold_paper_loss_lesson_mean_reversion_required",
      };
    }
  }
  return {
    recentStopLosses,
    confidenceBump,
    blockBuy: false,
    reason: `paper_loss_lesson_bump_${recentStopLosses}`,
  };
}
