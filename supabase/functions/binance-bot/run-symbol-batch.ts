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
import { assertExpectedEgressIpOrThrow } from "./exchange-client.ts";

export type BalanceSyncTarget = {
  isLiveMode: boolean;
  hasPaperMode: boolean;
  symbols: Set<string>;
};

export type SymbolBatchResult = {
  symbolFilter: string;
  actions: BotActionResult[];
  balanceSyncTargets: Map<string, BalanceSyncTarget>;
  cycleEmergencyAbort: boolean;
  cycleId: string;
  allSettledElapsedMs: number;
  scanned: number;
  batchTimeouts: number;
  batchErrors: number;
};

export function summarizeBatchActions(actions: BotActionResult[]): {
  batchTimeouts: number;
  batchErrors: number;
} {
  let batchTimeouts = 0;
  let batchErrors = 0;
  for (const action of actions) {
    const detail = String(action.detail ?? "");
    if (action.action === "skip" && detail.startsWith("TIMEOUT_HOLD:")) {
      batchTimeouts += 1;
    } else if (action.action === "error") {
      batchErrors += 1;
    }
  }
  return { batchTimeouts, batchErrors };
}

export function readPostBatchBalanceSyncEnabled(): boolean {
  const raw = String(Deno.env.get("POST_BATCH_BALANCE_SYNC") ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

export async function runSymbolBatch(params: {
  supabase: ReturnType<typeof createClient>;
  symbolFilter: string;
  lastAiPriceBySymbol: Map<string, number>;
  marketCache?: Map<string, import("./types.ts").IndicatorSnapshot>;
  paperScenario?: { name: import("./paper-scenario-snapshot.ts").PaperScenarioName; execute: boolean } | null;
  symbolMatrixIndex?: number;
  btcOverbought?: boolean;
}): Promise<SymbolBatchResult> {
  const {
    supabase,
    symbolFilter,
    lastAiPriceBySymbol,
    marketCache,
    paperScenario,
    symbolMatrixIndex,
    btcOverbought: btcOverboughtHint,
  } = params;
  const validated = await validateSymbolBatchInput({
    supabase,
    symbolFilter,
    marketCache,
    btcOverbought: btcOverboughtHint,
  });
  if (validated.empty) return validated.result;
  const { activeBots, symbolCache, cycleId, btcOverbought, botCycleTimeoutMs, balanceSyncTargets } = validated;
  const ownsMarketCache = !marketCache;
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
      symbolMatrixIndex,
    });
    const { batchTimeouts, batchErrors } = summarizeBatchActions(orchestrated.actions);
    return {
      symbolFilter,
      balanceSyncTargets,
      cycleId,
      batchTimeouts,
      batchErrors,
      ...orchestrated,
    };
  } finally {
    setActiveTelegramCycleId(null);
    if (ownsMarketCache) {
      symbolCache.clear();
    }
  }
}

export function mergeBalanceSyncTargets(
  into: Map<string, BalanceSyncTarget>,
  chunk: Map<string, BalanceSyncTarget>,
) {
  for (const [uid, t] of chunk) {
    const prev = into.get(uid) ?? { isLiveMode: false, hasPaperMode: false, symbols: new Set<string>() };
    prev.isLiveMode = prev.isLiveMode || t.isLiveMode;
    prev.hasPaperMode = prev.hasPaperMode || t.hasPaperMode;
    for (const s of t.symbols) prev.symbols.add(s);
    into.set(uid, prev);
  }
}

export async function runPostBatchBalanceSync(params: {
  supabase: ReturnType<typeof createClient>;
  balanceSyncTargets: Map<string, BalanceSyncTarget>;
  fallbackSymbol: string;
}): Promise<{ synced: number; skipped: boolean; liveTotalBalance?: number }> {
  const { supabase, balanceSyncTargets, fallbackSymbol } = params;
  if (!readPostBatchBalanceSyncEnabled()) {
    return { synced: 0, skipped: true };
  }

  const liveTargets = [...balanceSyncTargets.entries()].filter(([, target]) => target.isLiveMode);
  if (!liveTargets.length) {
    return { synced: 0, skipped: true };
  }

  let liveTotalBalance = 0;
  try {
    await assertExpectedEgressIpOrThrow();
    liveTotalBalance = await getTotalAccountBalanceUsdt(false);
  } catch (error) {
    const detail = formatUnknownError(error);
    botError("index", "balance_sync_prefetch_failed", { detail, live_users: liveTargets.length });
    await safeExecute("catch_balance_sync_prefetch_failed_log", () => supabase.from("logs").insert([{
      user_id: null,
      symbol: fallbackSymbol,
      level: "warn",
      source: "balance-sync",
      message: "profile_balance_sync_prefetch_failed",
      meta: { event: "profile_balance_sync_prefetch_failed", detail, live_users: liveTargets.length },
      created_at: new Date().toISOString(),
    }]), undefined);
    return { synced: 0, skipped: true };
  }

  if (!Number.isFinite(liveTotalBalance) || liveTotalBalance <= 0) {
    return { synced: 0, skipped: true };
  }

  const sharedWallet = liveTargets.length > 1;
  const syncedAt = new Date().toISOString();
  const roundedBalance = Number(liveTotalBalance.toFixed(2));
  let synced = 0;

  for (const [userId, target] of liveTargets) {
    const logSymbol = [...target.symbols][0] ?? fallbackSymbol;
    try {
      await updateProfileBalance(supabase, userId, liveTotalBalance);
      await supabase.from("account_balances").insert([{
        user_id: userId,
        balance: roundedBalance,
        timestamp: syncedAt,
        extra: {
          source: "balance-sync",
          symbols: [...target.symbols],
          shared_wallet: sharedWallet,
          live_users_in_batch: liveTargets.length,
        },
      }]);
      await supabase.from("logs").insert([{
        user_id: userId,
        symbol: logSymbol,
        level: "info",
        source: "balance-sync",
        message: "profile_balance_synced_from_binance",
        meta: {
          event: "profile_balance_synced_from_binance",
          live_total_balance: roundedBalance,
          shared_wallet: sharedWallet,
          live_users_in_batch: liveTargets.length,
        },
        created_at: syncedAt,
      }]);
      synced += 1;
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

  return { synced, skipped: false, liveTotalBalance: roundedBalance };
}
