// @ts-nocheck
/** Staggered parallel cron symbol batches (provider matrix / serial quota mode). */
import type { createClient } from "npm:@supabase/supabase-js@2";
import { DEFAULT_SYMBOL } from "./constants.ts";
import type { BotActionResult } from "./types.ts";
import { normalizeSymbol, sleepMs } from "./utils.ts";
import { botDebug } from "./bot-debug.ts";
import { withTelegramCycleScope } from "./bot-shared.ts";
import { enqueueCycleLog } from "./cycle-log-buffer.ts";
import {
  resolvePreemptiveKeyIndex,
} from "./llm-key-preemptive-route.ts";
import {
  resolveMatrixPrimaryProvider,
} from "./ai-provider-matrix.ts";
import {
  mergeBalanceSyncTargets,
  runSymbolBatch,
  type BalanceSyncTarget,
} from "./run-symbol-batch.ts";

export type CronSymbolBatchAccum = {
  allActions: BotActionResult[];
  mergedTargets: Map<string, BalanceSyncTarget>;
  cycleEmergencyAbort: boolean;
  totalMs: number;
  totalScanned: number;
  perSymbol: Array<{ symbol: string; ok: boolean; detail?: string; scanned?: number }>;
};

export async function runCronSymbolBatchesStaggeredParallel(params: {
  supabase: ReturnType<typeof createClient>;
  symbols: string[];
  lastAiPriceBySymbol: Map<string, number>;
  marketCache: Map<string, import("./types.ts").IndicatorSnapshot>;
  btcOverbought: boolean;
  batchId: string;
  interSymbolGapMs: number;
  matrixRouting: boolean;
  groqPoolN: number;
  gemPoolN: number;
}): Promise<CronSymbolBatchAccum> {
  const {
    supabase,
    symbols,
    lastAiPriceBySymbol,
    marketCache,
    btcOverbought,
    batchId,
    interSymbolGapMs,
    matrixRouting,
    groqPoolN,
    gemPoolN,
  } = params;

  const accum: CronSymbolBatchAccum = {
    allActions: [],
    mergedTargets: new Map(),
    cycleEmergencyAbort: false,
    totalMs: 0,
    totalScanned: 0,
    perSymbol: [],
  };

  botDebug(
    "cron",
    matrixRouting ? "parallel_symbol_cycles_provider_matrix" : "parallel_symbol_cycles_gemini_quota",
    {
      gap_ms: interSymbolGapMs,
      n_symbols: symbols.length,
      batch_id: batchId,
      matrix_routing: matrixRouting ? 1 : 0,
      stagger: "index_times_gap_before_spawn",
    },
  );

  const settled = await Promise.allSettled(
    symbols.map(async (symbolFilter, symbolMatrixIndex) => {
      if (symbolMatrixIndex > 0 && interSymbolGapMs > 0) {
        await sleepMs(symbolMatrixIndex * interSymbolGapMs);
      }
      const sym = normalizeSymbol(symbolFilter ?? DEFAULT_SYMBOL, DEFAULT_SYMBOL);
      if (matrixRouting) {
        const primary = resolveMatrixPrimaryProvider(symbolMatrixIndex);
        const groqKeyIdx = groqPoolN > 0
          ? resolvePreemptiveKeyIndex(symbolMatrixIndex, groqPoolN)
          : -1;
        const gemKeyIdx = gemPoolN > 0
          ? resolvePreemptiveKeyIndex(symbolMatrixIndex, gemPoolN)
          : -1;
        console.log(
          `[cron] matrix route ${sym} idx=${symbolMatrixIndex} primary=${primary} groq_key=${groqKeyIdx + 1}/${groqPoolN} gemini_key=${gemKeyIdx + 1}/${gemPoolN}`,
        );
      }
      const batchResult = await withTelegramCycleScope(null, () =>
        runSymbolBatch({
          supabase,
          symbolFilter,
          lastAiPriceBySymbol,
          marketCache,
          symbolMatrixIndex,
          btcOverbought,
        }),
      );
      return { sym, symbolFilter, batchResult };
    }),
  );

  for (let i = 0; i < settled.length; i += 1) {
    const sym = normalizeSymbol(symbols[i] ?? DEFAULT_SYMBOL, DEFAULT_SYMBOL);
    const entry = settled[i];
    if (entry.status !== "fulfilled") {
      accum.perSymbol.push({ symbol: sym, ok: false, detail: String(entry.reason) });
      enqueueCycleLog({
        level: "error",
        source: "symbol-cycle",
        symbol: sym,
        message: "symbol_cycle_failed",
        meta: { event: "symbol_cycle_failed", detail: String(entry.reason), batch_id: batchId },
      });
      continue;
    }
    const { batchResult } = entry.value;
    mergeBalanceSyncTargets(accum.mergedTargets, batchResult.balanceSyncTargets);
    accum.allActions.push(...batchResult.actions);
    accum.cycleEmergencyAbort ||= batchResult.cycleEmergencyAbort;
    accum.totalMs += batchResult.allSettledElapsedMs;
    accum.totalScanned += batchResult.scanned;
    accum.perSymbol.push({ symbol: sym, ok: true, scanned: batchResult.scanned });
  }

  return accum;
}
