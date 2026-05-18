// @ts-nocheck
/** Cached `bot_global_settings` row — read once per symbol tick (no LLM). */

import type { createClient } from "npm:@supabase/supabase-js@2";

export type BotGlobalSettingsRow = {
  market_regime: string;
  allowed_leverage: number;
  global_trade_multiplier: number;
};

const DEFAULTS: BotGlobalSettingsRow = {
  market_regime: "NEUTRAL",
  allowed_leverage: 10,
  global_trade_multiplier: 1,
};

/** Safe fallback when hourly macro LLM fails — fast lane must never freeze. */
export const SAFE_MACRO_DEFAULTS: BotGlobalSettingsRow = {
  market_regime: "NEUTRAL",
  allowed_leverage: 10,
  global_trade_multiplier: 1,
};

let cycleCache: { atMs: number; row: BotGlobalSettingsRow } | null = null;
const CACHE_TTL_MS = 5000;

export function readFastBounceFuturesLaneEnabled(): boolean {
  const raw = String(Deno.env.get("FAST_BOUNCE_FUTURES_LANE") ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no";
}

export function readFastBounceAccountUsd(): number {
  const raw = Number(Deno.env.get("FAST_BOUNCE_ACCOUNT_USD") ?? "27");
  if (!Number.isFinite(raw) || raw <= 0) return 27;
  return Math.min(500, Math.max(5, raw));
}

export function isHighRiskCrashRegime(regime: string): boolean {
  return String(regime ?? "").trim().toUpperCase() === "HIGH_RISK_CRASH";
}

export async function loadBotGlobalSettings(
  supabase: ReturnType<typeof createClient>,
): Promise<BotGlobalSettingsRow> {
  const now = Date.now();
  if (cycleCache && now - cycleCache.atMs < CACHE_TTL_MS) {
    return cycleCache.row;
  }
  const { data, error } = await supabase
    .from("bot_global_settings")
    .select("market_regime, allowed_leverage, global_trade_multiplier")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`[bot_global_settings] fetch failed: ${error.message}`);
    return DEFAULTS;
  }
  const row: BotGlobalSettingsRow = {
    market_regime: String(data?.market_regime ?? DEFAULTS.market_regime).trim() ||
      DEFAULTS.market_regime,
    allowed_leverage: Math.min(
      50,
      Math.max(1, Math.floor(Number(data?.allowed_leverage ?? DEFAULTS.allowed_leverage))),
    ),
    global_trade_multiplier: Math.min(
      5,
      Math.max(0.1, Number(data?.global_trade_multiplier ?? DEFAULTS.global_trade_multiplier)),
    ),
  };
  cycleCache = { atMs: now, row };
  return row;
}

export function clearBotGlobalSettingsCacheForTests(): void {
  cycleCache = null;
}

export async function persistBotGlobalSettings(
  supabase: ReturnType<typeof createClient>,
  row: BotGlobalSettingsRow,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const payload = {
    market_regime: String(row.market_regime).trim(),
    allowed_leverage: Math.min(50, Math.max(1, Math.floor(row.allowed_leverage))),
    global_trade_multiplier: Math.min(
      5,
      Math.max(0, Number(row.global_trade_multiplier)),
    ),
    updated_at: new Date().toISOString(),
  };

  const { data: existing, error: readErr } = await supabase
    .from("bot_global_settings")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (readErr) {
    return { ok: false, error: readErr.message };
  }

  if (existing?.id) {
    const { error } = await supabase
      .from("bot_global_settings")
      .update(payload)
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    cycleCache = null;
    return { ok: true, id: String(existing.id) };
  }

  const { data: inserted, error } = await supabase
    .from("bot_global_settings")
    .insert([payload])
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  cycleCache = null;
  return { ok: true, id: inserted?.id ? String(inserted.id) : undefined };
}
