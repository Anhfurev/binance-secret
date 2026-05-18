// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { fetchIndicatorSnapshot } from "./binance.ts";
import { getCachedSnapshot } from "./index-ai.ts";
import { resolveGhostMode, resolveTestMode } from "./bot-shared.ts";
import { safeExecute } from "./safe-execute.ts";
import { CRON_SYMBOL_MATRIX_ORDER, DEFAULT_SYMBOL } from "./constants.ts";
import { normalizeSymbol, toStringValue } from "./utils.ts";
import { readCronSerialSymbolCyclesEnabled, readSymbolMatrixGapMs } from "./ai-provider-matrix.ts";
import { resolveBtcOverboughtFromMarketCache } from "./market-anchor.ts";

export function readBotCycleTimeoutMs(): number {
  const raw = String(Deno.env.get("BOT_CYCLE_TIMEOUT_MS") ?? "").trim();
  const n = raw.length ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 55_000;
  return Math.min(120_000, Math.max(10_000, Math.floor(n)));
}

/** Extra delay between each symbol in a batch (reduces Binance/LLM burst). Set `BOT_SYMBOL_STAGGER_MS=0` to disable. */
export function readBotSymbolStaggerMs(): number {
  const raw = String(Deno.env.get("BOT_SYMBOL_STAGGER_MS") ?? "3000").trim();
  if (!raw.length) return 3000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 3000;
  return Math.min(15_000, Math.floor(n));
}

/** Run active bots for the same symbol in parallel. Default **on**; set `BOT_PARALLEL_SYMBOL_CYCLES=0` to serialize. */
export function readBotParallelSymbolCyclesEnabled(): boolean {
  const raw = String(Deno.env.get("BOT_PARALLEL_SYMBOL_CYCLES") ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no";
}

/**
 * When Gemini may run (`getAiAnalysis` paths), parallel symbol/bot races blow through the shared
 * key pool before `ai_quota_state` updates. Forces serialized cron + disables `BOT_PARALLEL_SYMBOL_CYCLES`.
 */
/** @deprecated use readCronSerialSymbolCyclesEnabled */
export function readSerialSymbolCyclesForGeminiQuota(): boolean {
  return readCronSerialSymbolCyclesEnabled();
}

/** Gap between cron `runSymbolBatch` calls when serial matrix / Gemini quota mode is on. */
export function readGeminiCronSymbolGapMs(): number {
  if (!readCronSerialSymbolCyclesEnabled()) return 0;
  return readSymbolMatrixGapMs();
}

/** Matrix index for provider routing (matches cron body symbol order). */
export function resolveCronSymbolMatrixIndex(symbol: string): number | undefined {
  const sym = normalizeSymbol(symbol, DEFAULT_SYMBOL);
  const idx = (CRON_SYMBOL_MATRIX_ORDER as readonly string[]).indexOf(sym);
  return idx >= 0 ? idx : undefined;
}

/** True when validateSymbolBatchInput should call Binance for a BTCUSDT anchor snapshot. */
export function shouldPrefetchBtcMarketAnchor(params: {
  btcOverboughtHint?: boolean;
  skipBtcMarketAnchor?: boolean;
}): boolean {
  if (params.skipBtcMarketAnchor) return false;
  return params.btcOverboughtHint === undefined;
}

export async function validateSymbolBatchInput(params: {
  supabase: ReturnType<typeof createClient>;
  symbolFilter: string;
  marketCache?: Map<string, import("./types.ts").IndicatorSnapshot>;
  /** Cron preflight BTC anchor — skips redundant BTCUSDT snapshot work per symbol. */
  btcOverbought?: boolean;
  /** Single-symbol staging (e.g. test-sol-loop): no BTCUSDT fetch or cache entries. */
  skipBtcMarketAnchor?: boolean;
}) {
  const {
    supabase,
    symbolFilter,
    marketCache,
    btcOverbought: btcOverboughtHint,
    skipBtcMarketAnchor,
  } = params;
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
        balanceSyncTargets: new Map<string, { isLiveMode: boolean; hasPaperMode: boolean; symbols: Set<string> }>(),
        cycleEmergencyAbort: false,
        cycleId: crypto.randomUUID(),
        allSettledElapsedMs: 0,
        scanned: 0,
        batchTimeouts: 0,
        batchErrors: 0,
      },
    };
  }
  const symbolCache = marketCache ?? new Map<string, import("./types.ts").IndicatorSnapshot>();
  let btcOverbought: boolean;
  if (shouldPrefetchBtcMarketAnchor({ btcOverboughtHint, skipBtcMarketAnchor })) {
    if (!symbolCache.has("BTCUSDT")) {
      await safeExecute(
        "market_snapshot_BTCUSDT",
        () => getCachedSnapshot(symbolCache, "BTCUSDT", fetchIndicatorSnapshot),
        null,
      );
    }
    btcOverbought = resolveBtcOverboughtFromMarketCache(symbolCache);
  } else {
    btcOverbought = btcOverboughtHint ?? false;
  }
  const balanceSyncTargets = new Map<string, { isLiveMode: boolean; hasPaperMode: boolean; symbols: Set<string> }>();
  for (const row of activeBots) {
    const uid = toStringValue((row as any).user_id) ?? "unknown";
    if (uid === "unknown") continue;
    const sym = normalizeSymbol((row as any).symbol, DEFAULT_SYMBOL);
    const previous = balanceSyncTargets.get(uid) ?? { isLiveMode: false, hasPaperMode: false, symbols: new Set<string>() };
    previous.isLiveMode = previous.isLiveMode || (!resolveTestMode(row) && !resolveGhostMode(row));
    previous.hasPaperMode = previous.hasPaperMode || (resolveTestMode(row) && !resolveGhostMode(row));
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
