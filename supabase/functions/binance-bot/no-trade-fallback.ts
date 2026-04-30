// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";

const NO_TRADE_FALLBACK_AFTER_DAYS = 20;

export type NoTradeFallbackResult = {
  active: boolean;
  daysSinceLastBuy: number | null;
  adjustedMinAiConfidence: number;
  adjustedMinTechScore: number;
  forceAggressiveMode: boolean;
  reason: string | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export async function resolveNoTradeFallback(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  hasOpenTrade: boolean;
  minAiConfidence: number;
  minTechScore: number;
}): Promise<NoTradeFallbackResult> {
  const {
    supabase,
    userId,
    symbol,
    hasOpenTrade,
    minAiConfidence,
    minTechScore,
  } = params;

  if (hasOpenTrade || !userId || userId === "unknown") {
    return {
      active: false,
      daysSinceLastBuy: null,
      adjustedMinAiConfidence: minAiConfidence,
      adjustedMinTechScore: minTechScore,
      forceAggressiveMode: false,
      reason: null,
    };
  }

  const lastBuyResult = await supabase
    .from("trades")
    .select("opened_at,created_at")
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .ilike("type", "buy")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastBuyResult.error) {
    return {
      active: false,
      daysSinceLastBuy: null,
      adjustedMinAiConfidence: minAiConfidence,
      adjustedMinTechScore: minTechScore,
      forceAggressiveMode: false,
      reason: `fallback_query_failed:${lastBuyResult.error.message}`,
    };
  }

  const lastTs = String(lastBuyResult.data?.opened_at ?? lastBuyResult.data?.created_at ?? "");
  const lastMs = Date.parse(lastTs);
  const daysSinceLastBuy = Number.isFinite(lastMs)
    ? Math.floor((Date.now() - lastMs) / (24 * 60 * 60 * 1000))
    : null;

  const neverBought = !Number.isFinite(lastMs);
  const inactiveLongEnough = neverBought || (daysSinceLastBuy ?? 0) >= NO_TRADE_FALLBACK_AFTER_DAYS;
  if (!inactiveLongEnough) {
    return {
      active: false,
      daysSinceLastBuy,
      adjustedMinAiConfidence: minAiConfidence,
      adjustedMinTechScore: minTechScore,
      forceAggressiveMode: false,
      reason: null,
    };
  }

  // Controlled relaxation:
  // - confidence floor: at most -10 points, hard floor 55
  // - technical floor: at most -2 points, hard floor 3
  const adjustedMinAiConfidence = clamp(minAiConfidence - 10, 55, 95);
  const adjustedMinTechScore = clamp(minTechScore - 2, 3, 10);

  return {
    active: true,
    daysSinceLastBuy,
    adjustedMinAiConfidence,
    adjustedMinTechScore,
    forceAggressiveMode: true,
    reason: neverBought
      ? "no_trade_fallback_activated_never_bought"
      : `no_trade_fallback_activated_${daysSinceLastBuy}d`,
  };
}
