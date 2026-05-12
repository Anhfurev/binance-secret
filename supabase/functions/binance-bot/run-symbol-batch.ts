// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { BotActionResult } from "./types.ts";
import { botError } from "./bot-debug.ts";
import { getTotalAccountBalanceUsdt } from "./binance.ts";
import { updateProfileBalance } from "./trade-store.ts";
import { setActiveTelegramCycleId } from "./bot-shared.ts";
import { safeExecute } from "./safe-execute.ts";
import { formatUnknownError } from "./utils.ts";
import { validateSymbolBatchInput } from "./batch-validator.ts";
import { orchestrateSymbolBatch } from "./batch-orchestrator.ts";

export type SymbolBatchResult = {
  symbolFilter: string;
  actions: BotActionResult[];
  balanceSyncTargets: Map<string, { isLiveMode: boolean; symbols: Set<string> }>;
  cycleEmergencyAbort: boolean;
  cycleId: string;
  allSettledElapsedMs: number;
  scanned: number;
};

export async function runSymbolBatch(params: {
  supabase: ReturnType<typeof createClient>;
  symbolFilter: string;
  lastAiPriceBySymbol: Map<string, number>;
  marketCache?: Map<string, import("./types.ts").IndicatorSnapshot>;
  paperScenario?: { name: import("./paper-scenario-snapshot.ts").PaperScenarioName; execute: boolean } | null;
}): Promise<SymbolBatchResult> {
  const { supabase, symbolFilter, lastAiPriceBySymbol, marketCache, paperScenario } = params;
  const validated = await validateSymbolBatchInput({ supabase, symbolFilter, marketCache });
  if (validated.empty) return validated.result;
  const { activeBots, symbolCache, cycleId, btcOverbought, botCycleTimeoutMs, balanceSyncTargets } = validated;
  setActiveTelegramCycleId(cycleId);
  try {
    const orchestrated = await orchestrateSymbolBatch({
      supabase,
      symbolFilter,
      activeBots,
      symbolCache,
      lastAiPriceBySymbol,
      paperScenario,
      cycleId,
      btcOverbought,
      botCycleTimeoutMs,
    });
    return { symbolFilter, balanceSyncTargets, cycleId, ...orchestrated };
  } finally {
    setActiveTelegramCycleId(null);
    symbolCache.clear();
  }
}

export function mergeBalanceSyncTargets(
  into: Map<string, { isLiveMode: boolean; symbols: Set<string> }>,
  chunk: Map<string, { isLiveMode: boolean; symbols: Set<string> }>,
) {
  for (const [uid, t] of chunk) {
    const prev = into.get(uid) ?? { isLiveMode: false, symbols: new Set<string>() };
    prev.isLiveMode = prev.isLiveMode || t.isLiveMode;
    for (const s of t.symbols) prev.symbols.add(s);
    into.set(uid, prev);
  }
}

export async function runPostBatchBalanceSync(params: {
  supabase: ReturnType<typeof createClient>;
  balanceSyncTargets: Map<string, { isLiveMode: boolean; symbols: Set<string> }>;
  fallbackSymbol: string;
}) {
  const { supabase, balanceSyncTargets, fallbackSymbol } = params;
  for (const [userId, target] of balanceSyncTargets.entries()) {
    if (!target.isLiveMode) continue;
    const logSymbol = [...target.symbols][0] ?? fallbackSymbol;
    try {
      const liveTotalBalance = await getTotalAccountBalanceUsdt(false);
      if (!Number.isFinite(liveTotalBalance) || liveTotalBalance <= 0) continue;
      await updateProfileBalance(supabase, userId, liveTotalBalance);
      await supabase.from("account_balances").insert([{
        user_id: userId,
        balance: Number(liveTotalBalance.toFixed(2)),
        timestamp: new Date().toISOString(),
        extra: { source: "balance-sync", symbols: [...target.symbols] },
      }]);
      await supabase.from("logs").insert([{
        user_id: userId,
        symbol: logSymbol,
        level: "info",
        source: "balance-sync",
        message: "profile_balance_synced_from_binance",
        meta: { event: "profile_balance_synced_from_binance", live_total_balance: Number(liveTotalBalance.toFixed(2)) },
        created_at: new Date().toISOString(),
      }]);
    } catch (error) {
      const detail = formatUnknownError(error);
      botError("index", "balance_sync_failed", { userId, symbol: logSymbol, detail });
      await safeExecute("catch_balance_sync_failed_log", () => supabase.from("logs").insert([{
        user_id: userId,
        symbol: logSymbol,
        level: "warn",
        source: "balance-sync",
        message: "profile_balance_sync_failed",
        meta: { event: "profile_balance_sync_failed", detail },
        created_at: new Date().toISOString(),
      }]), undefined);
    }
  }
}
