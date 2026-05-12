// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { readDemoProbeEnabled } from "./paper-balance.ts";
import { blockedByPostStoplossCooldown } from "./stop-reentry-cooldown.ts";

/**
 * No BUY recorded for this long (in HOURS) → eligible for a paper/demo probe buy.
 * Aggressive default for demo so the user can validate the BUY pipeline:
 * if the bot has been silent for a few hours, try one paper trade.
 */
function readProbeMinutes(): number {
  const raw = String(Deno.env.get("DEMO_PROBE_INACTIVITY_HOURS") ?? "").trim();
  const n = raw.length ? Number(raw) : 0.5;
  const hours = Number.isFinite(n) ? Math.min(48, Math.max(0.25, n)) : 0.5;
  return Math.max(15, Math.round(hours * 60));
}

function readProbeCooldownMs(): number {
  const raw = String(Deno.env.get("DEMO_PROBE_COOLDOWN_MINUTES") ?? "").trim();
  const n = raw.length ? Number(raw) : 15;
  const minutes = Number.isFinite(n) ? Math.min(24 * 60, Math.max(10, Math.floor(n))) : 15;
  return minutes * 60 * 1000;
}

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
  if (!readDemoProbeEnabled()) {
    return { apply: false, reason: "demo_probe_disabled" };
  }
  if (hasOpenTrade || !userId || userId === "unknown") {
    return { apply: false, reason: null };
  }

  const stopCooldown = await blockedByPostStoplossCooldown({
    supabase,
    userId,
    symbol,
    paperOnly: true,
  });
  if (stopCooldown.blocked) {
    return { apply: false, reason: stopCooldown.reason ?? "demo_probe_post_stop_cooldown" };
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
    if (Number.isFinite(ms) && Date.now() - ms < readProbeCooldownMs()) {
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
  const minutesSinceLastBuy = Number.isFinite(lastMs)
    ? Math.floor((Date.now() - lastMs) / (60 * 1000))
    : null;

  const neverBought = !Number.isFinite(lastMs);
  const inactiveLongEnough =
    neverBought || (minutesSinceLastBuy ?? 0) >= readProbeMinutes();

  if (!inactiveLongEnough) {
    return { apply: false, reason: null };
  }

  return {
    apply: true,
    reason: neverBought
      ? "demo_inactivity_probe_buy_never_bought"
      : `demo_inactivity_probe_buy_${minutesSinceLastBuy}m`,
  };
}
