// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";

/** No BUY recorded for this long → eligible for one paper/demo probe buy (fake money). */
const DEMO_PROBE_INACTIVITY_DAYS = 10;
/** Minimum gap between probe attempts (avoids BUY spam every cron tick while inactive). */
const PROBE_COOLDOWN_MS = 2 * 60 * 60 * 1000;

export type DemoPaperProbeBuyResult = {
  apply: boolean;
  reason: string | null;
};

/**
 * One-shot style probe for **paper / demo only** (`is_live_trading_enabled` false).
 * Never runs when live trading is enabled (real Binance orders path).
 */
export async function resolveDemoPaperProbeBuy(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  row: Record<string, unknown>;
  hasOpenTrade: boolean;
}): Promise<DemoPaperProbeBuyResult> {
  const { supabase, userId, symbol, row, hasOpenTrade } = params;

  if (Boolean((row as any)?.is_live_trading_enabled)) {
    return { apply: false, reason: null };
  }
  if (hasOpenTrade || !userId || userId === "unknown") {
    return { apply: false, reason: null };
  }

  const lastProbe = await supabase
    .from("logs")
    .select("created_at")
    .eq("source", "demo-probe-buy")
    .eq("message", "demo_paper_probe_activated")
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastProbe.error && lastProbe.data?.created_at) {
    const ms = Date.parse(String(lastProbe.data.created_at));
    if (Number.isFinite(ms) && Date.now() - ms < PROBE_COOLDOWN_MS) {
      return { apply: false, reason: "demo_probe_cooldown_active" };
    }
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
      apply: false,
      reason: `demo_probe_query_failed:${lastBuyResult.error.message}`,
    };
  }

  const lastTs = String(
    lastBuyResult.data?.opened_at ?? lastBuyResult.data?.created_at ?? "",
  );
  const lastMs = Date.parse(lastTs);
  const daysSinceLastBuy = Number.isFinite(lastMs)
    ? Math.floor((Date.now() - lastMs) / (24 * 60 * 60 * 1000))
    : null;

  const neverBought = !Number.isFinite(lastMs);
  const inactiveLongEnough =
    neverBought || (daysSinceLastBuy ?? 0) >= DEMO_PROBE_INACTIVITY_DAYS;

  if (!inactiveLongEnough) {
    return { apply: false, reason: null };
  }

  return {
    apply: true,
    reason: neverBought
      ? "demo_inactivity_probe_buy_never_bought"
      : `demo_inactivity_probe_buy_${daysSinceLastBuy}d`,
  };
}
