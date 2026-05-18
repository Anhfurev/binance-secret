// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { IndicatorSnapshot } from "../binance-bot/types.ts";
import { resolveCronSymbolMatrixIndex } from "../binance-bot/batch-validator.ts";
import { runSymbolBatch, type SymbolBatchResult } from "../binance-bot/run-symbol-batch.ts";

const TEST_SYMBOL = "SOLUSDT";

function readTestSolLoopMaxBots(): number {
  const raw = String(Deno.env.get("TEST_SOL_LOOP_MAX_BOTS") ?? "1").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(10, Math.floor(n));
}

export type SolIsolatedBatchParams = {
  supabase: ReturnType<typeof createClient>;
  lastAiPriceBySymbol: Map<string, number>;
  paperScenario?: { name: import("../binance-bot/paper-scenario-snapshot.ts").PaperScenarioName; execute: boolean } | null;
};

/** One SOLUSDT batch: no BTC anchor, no stagger sleep, bounded bot count. */
export async function runSolIsolatedSymbolBatch(
  params: SolIsolatedBatchParams,
): Promise<SymbolBatchResult> {
  const solOnlyMarketCache = new Map<string, IndicatorSnapshot>();
  const solOnlyAiPrices = new Map<string, number>();
  for (const [sym, price] of params.lastAiPriceBySymbol) {
    if (sym === TEST_SYMBOL) solOnlyAiPrices.set(sym, price);
  }

  return await runSymbolBatch({
    supabase: params.supabase,
    symbolFilter: TEST_SYMBOL,
    lastAiPriceBySymbol: solOnlyAiPrices,
    marketCache: solOnlyMarketCache,
    paperScenario: params.paperScenario,
    symbolMatrixIndex: resolveCronSymbolMatrixIndex(TEST_SYMBOL),
    skipBtcMarketAnchor: true,
    btcOverbought: false,
    skipFrictionSpreadRefresh: true,
    maxActiveBots: readTestSolLoopMaxBots(),
  });
}
