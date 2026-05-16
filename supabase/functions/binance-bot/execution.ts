// @ts-nocheck
/**
 * Legacy Kelly sizing helpers — not on the live buy path (see `risk-to-stop-sizing.ts`).
 */
import type { createClient } from "npm:@supabase/supabase-js@2";
import { toNumber } from "./utils.ts";

const DEFAULT_WIN_LOSS_RATIO = 1;
const DEFAULT_MAX_POSITION_SIZE = 0.1; // 10% of balance
const DEFAULT_FRACTIONAL_KELLY = 0.25; // 25% Kelly for safety

export async function getWinLossRatio(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
}): Promise<number> {
  const { supabase, userId, symbol } = params;
  const { data, error } = await supabase
    .from("bot_performance")
    .select("win_count, loss_count")
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .maybeSingle();

  if (error) {
    console.warn(`[binance-bot] win/loss ratio fallback: ${error.message}`);
    return DEFAULT_WIN_LOSS_RATIO;
  }

  const winCount = toNumber((data as any)?.win_count, 0);
  const lossCount = toNumber((data as any)?.loss_count, 0);
  if (winCount <= 0 && lossCount <= 0) return DEFAULT_WIN_LOSS_RATIO;
  if (lossCount <= 0) return Math.max(DEFAULT_WIN_LOSS_RATIO, winCount || 1);
  return Math.max(0.1, winCount / lossCount);
}

export function calculateDynamicPositionSize(params: {
  aiConfidence: number; // probability 0-100
  winLossRatio: number; // avg win / avg loss proxy
  totalBalance: number;
  maxPositionSize?: number; // balance fraction, e.g. 0.10
  fractionalKelly?: number; // e.g. 0.25
}): number {
  const {
    aiConfidence,
    winLossRatio,
    totalBalance,
    maxPositionSize = DEFAULT_MAX_POSITION_SIZE,
    fractionalKelly = DEFAULT_FRACTIONAL_KELLY,
  } = params;

  const p = Math.min(1, Math.max(0, aiConfidence / 100));
  const q = 1 - p;
  const b = Math.max(0.1, winLossRatio);
  const rawKelly = p - q / b;
  const safeKelly = Math.max(0, rawKelly) * fractionalKelly;

  const cappedFraction = Math.min(maxPositionSize, safeKelly);
  return Math.max(0, totalBalance * cappedFraction);
}
