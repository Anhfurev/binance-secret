// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { fetchIndicatorSnapshot } from "./binance.ts";
import { getCachedSnapshot } from "./index-ai.ts";
import { resolveGhostMode, resolveTestMode } from "./bot-shared.ts";
import { safeExecute } from "./safe-execute.ts";
import { DEFAULT_SYMBOL } from "./constants.ts";
import { normalizeSymbol, toStringValue } from "./utils.ts";
import { hasValidNonZeroEma } from "./cycle-indicator-helpers.ts";

export function readBotCycleTimeoutMs(): number {
  const raw = String(Deno.env.get("BOT_CYCLE_TIMEOUT_MS") ?? "").trim();
  const n = raw.length ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 55_000;
  return Math.min(120_000, Math.max(10_000, Math.floor(n)));
}

export async function validateSymbolBatchInput(params: {
  supabase: ReturnType<typeof createClient>;
  symbolFilter: string;
  marketCache?: Map<string, import("./types.ts").IndicatorSnapshot>;
}) {
  const { supabase, symbolFilter, marketCache } = params;
  const botsQuery = await safeExecute("db_bot_settings_for_symbol", async () => {
    const r = await supabase.from("bot_settings").select("*").eq("is_autopilot_enabled", true).eq("symbol", symbolFilter);
    if (r.error) throw r.error;
    return r;
  }, { data: [] as unknown[], error: null as null });
  const activeBots = (botsQuery.data ?? []) as any[];
  if (!activeBots.length) {
    return {
      empty: true as const,
      result: {
        symbolFilter,
        actions: [],
        balanceSyncTargets: new Map<string, { isLiveMode: boolean; symbols: Set<string> }>(),
        cycleEmergencyAbort: false,
        cycleId: crypto.randomUUID(),
        allSettledElapsedMs: 0,
        scanned: 0,
      },
    };
  }
  const symbolCache = marketCache ?? new Map<string, import("./types.ts").IndicatorSnapshot>();
  const btcSnapshot = await safeExecute("market_snapshot_BTCUSDT", () => getCachedSnapshot(symbolCache, "BTCUSDT", fetchIndicatorSnapshot), null);
  const btcRsi = Number(btcSnapshot?.rsi ?? NaN);
  const btcOverbought = Number.isFinite(btcRsi) && btcRsi > 70 && hasValidNonZeroEma({
    emaFast: Number(btcSnapshot?.emaFast ?? 0),
    emaSlow: Number(btcSnapshot?.emaSlow ?? 0),
    ema200: Number(btcSnapshot?.ema200 ?? 0),
  });
  const balanceSyncTargets = new Map<string, { isLiveMode: boolean; symbols: Set<string> }>();
  for (const row of activeBots) {
    const uid = toStringValue((row as any).user_id) ?? "unknown";
    if (uid === "unknown") continue;
    const sym = normalizeSymbol((row as any).symbol, DEFAULT_SYMBOL);
    const previous = balanceSyncTargets.get(uid) ?? { isLiveMode: false, symbols: new Set<string>() };
    previous.isLiveMode = previous.isLiveMode || (!resolveTestMode(row) && !resolveGhostMode(row));
    previous.symbols.add(sym);
    balanceSyncTargets.set(uid, previous);
  }
  return {
    empty: false as const,
    activeBots,
    symbolCache,
    btcOverbought,
    balanceSyncTargets,
    cycleId: crypto.randomUUID(),
    botCycleTimeoutMs: readBotCycleTimeoutMs(),
  };
}
