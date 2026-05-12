// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";

const NO_TRADE_FALLBACK_AFTER_DAYS = 10;

function readPaperNoTradeFallbackHours(): number {
  const raw = String(Deno.env.get("PAPER_NO_TRADE_FALLBACK_HOURS") ?? "1").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(72, Math.floor(n));
}

function readPaperNoTradeFallbackMinutes(): number {
  const raw = String(Deno.env.get("PAPER_NO_TRADE_FALLBACK_MINUTES") ?? "45").trim();
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 15) {
    return Math.min(24 * 60, Math.floor(n));
  }
  const hours = readPaperNoTradeFallbackHours();
  return Math.min(24 * 60, Math.max(15, hours * 60));
}

function readNoTradeFallbackForceAggressive(): boolean {
  const raw = String(Deno.env.get("NO_TRADE_FALLBACK_FORCE_AGGRESSIVE") ?? "0")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

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
  paperOnly?: boolean;
}): Promise<NoTradeFallbackResult> {
  const {
    supabase,
    userId,
    symbol,
    hasOpenTrade,
    minAiConfidence,
    minTechScore,
    paperOnly = false,
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
  const minutesSinceLastBuy = Number.isFinite(lastMs)
    ? Math.floor((Date.now() - lastMs) / (60 * 1000))
    : null;
  const daysSinceLastBuy = Number.isFinite(lastMs)
    ? Math.floor((Date.now() - lastMs) / (24 * 60 * 60 * 1000))
    : null;

  const neverBought = !Number.isFinite(lastMs);
  const inactiveLongEnough = paperOnly
    ? neverBought || (minutesSinceLastBuy ?? 0) >= readPaperNoTradeFallbackMinutes()
    : neverBought || (daysSinceLastBuy ?? 0) >= NO_TRADE_FALLBACK_AFTER_DAYS;
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
  const adjustedMinAiConfidence = clamp(minAiConfidence - 12, 48, 95);
  const adjustedMinTechScore = clamp(minTechScore - 2, 4, 10);

  return {
    active: true,
    daysSinceLastBuy,
    adjustedMinAiConfidence,
    adjustedMinTechScore,
    forceAggressiveMode: paperOnly || readNoTradeFallbackForceAggressive(),
    reason: neverBought
      ? "no_trade_fallback_activated_never_bought"
      : paperOnly
      ? `no_trade_fallback_activated_${minutesSinceLastBuy}m`
      : `no_trade_fallback_activated_${daysSinceLastBuy}d`,
  };
}
