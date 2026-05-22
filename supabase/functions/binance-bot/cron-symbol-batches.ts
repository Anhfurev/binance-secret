// @ts-nocheck
/** Parallel cron symbol batches — all symbols run concurrently (no index×gap stagger). */
import type { createClient } from "npm:@supabase/supabase-js@2";
import { DEFAULT_SYMBOL } from "./constants.ts";
import type { BotActionResult } from "./types.ts";
import { normalizeSymbol } from "./utils.ts";
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

export async function runCronSymbolBatchesParallel(params: {
  supabase: ReturnType<typeof createClient>;
  symbols: string[];
  lastAiPriceBySymbol: Map<string, number>;
  marketCache: Map<string, import("./types.ts").IndicatorSnapshot>;
  btcOverbought: boolean;
  btcMacroBounceGate: import("./macro-bounce-regime-gate.ts").BtcMacroBounceGate;
  batchId: string;
  matrixRouting: boolean;
  groqPoolN: number;
  gemPoolN: number;
  signal?: AbortSignal;
}): Promise<CronSymbolBatchAccum> {
  const {
    supabase,
    symbols,
    lastAiPriceBySymbol,
    marketCache,
    btcOverbought,
    btcMacroBounceGate,
    batchId,
    matrixRouting,
    groqPoolN,
    gemPoolN,
    signal,
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
    matrixRouting ? "parallel_symbol_cycles_provider_matrix" : "parallel_symbol_cycles",
    {
      n_symbols: symbols.length,
      batch_id: batchId,
      matrix_routing: matrixRouting ? 1 : 0,
      stagger: "none",
    },
  );

  const settled = await Promise.allSettled(
    symbols.map(async (symbolFilter, symbolMatrixIndex) => {
      if (signal?.aborted) {
        throw new DOMException("Edge cycle aborted", "AbortError");
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
          btcMacroBounceGate,
          signal,
        }),
      );
      return { sym, symbolFilter, batchResult };
    }),
  );

  for (let i = 0; i < settled.length; i += 1) {
    const sym = normalizeSymbol(symbols[i] ?? DEFAULT_SYMBOL, DEFAULT_SYMBOL);
    const entry = settled[i];
    if (entry.status !== "fulfilled") {
      const reason = String(entry.reason ?? "");
      if (signal?.aborted || reason.includes("AbortError") || reason.includes("aborted")) {
        accum.perSymbol.push({ symbol: sym, ok: false, detail: "edge_cycle_aborted" });
        continue;
      }
      accum.perSymbol.push({ symbol: sym, ok: false, detail: reason });
      enqueueCycleLog({
        level: "error",
        source: "symbol-cycle",
        symbol: sym,
        message: "symbol_cycle_failed",
        meta: { event: "symbol_cycle_failed", detail: reason, batch_id: batchId },
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

/** @deprecated Use runCronSymbolBatchesParallel — stagger removed. */
export const runCronSymbolBatchesStaggeredParallel = runCronSymbolBatchesParallel;
