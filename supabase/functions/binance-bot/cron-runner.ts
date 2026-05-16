// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { DEFAULT_SYMBOL } from "./constants.ts";
import type { BotActionResult } from "./types.ts";
import { jsonResponse, normalizeSymbol } from "./utils.ts";
import { botDebug } from "./bot-debug.ts";
import { binanceTimeSyncCheck, fetchIndicatorSnapshot } from "./binance.ts";
import { readLlmMaxConcurrent } from "./ai-llm-concurrency.ts";
import { getCachedSnapshot, resetAiCycleGuards } from "./index-ai.ts";
import { withTelegramCycleScope } from "./bot-shared.ts";
import { safeExecute, safeExecuteBackground, safeExecuteDetached } from "./safe-execute.ts";
import { detachCronTailSideEffects } from "./cron-tail-side-effects.ts";
import { runCronSymbolBatchesStaggeredParallel } from "./cron-symbol-batches.ts";
import { mergeBalanceSyncTargets, runPostBatchBalanceSync, runSymbolBatch } from "./run-symbol-batch.ts";
import { readCronMathTraceTelegramEnabled, sendCronMathTraceTelegram } from "./telegram-math-trace.ts";
import { readPaperWalletReconcileEnabled, reconcilePaperProfilesForUserIds } from "./paper-wallet-reconcile.ts";
import { shouldLogCronBatchStartRow } from "./log-policy.ts";
import { clearCycleLogBuffer, enqueueCycleLog } from "./cycle-log-buffer.ts";
import { recordCronCycleSummary } from "./cron-runner-telemetry.ts";
import { tryRunCronJanitor } from "./cron-janitor.ts";
import { runFunctionVitalityCheck } from "./function-health.ts";
import {
  clearCronBatchLlmKeyPools,
  fetchCronBatchLlmKeyPools,
  publishCronBatchLlmKeyPools,
  shouldPreemptiveRouteForSymbolIndex,
} from "./llm-key-preemptive-route.ts";
import { resolveBtcOverboughtFromMarketCache } from "./market-anchor.ts";
import { getAiQuotaState, patchAiQuotaState } from "./ai-db.ts";
import { buildPayload } from "./ai-core.ts";
import { readAiPrimaryLlmIsGroq } from "./ai-llm-route.ts";
import { readAiProviderMatrixEnabled } from "./ai-provider-matrix.ts";
import {
  clearGroqMultiSymbolBatch,
  groqAnalyzeMultiSymbol,
  readGroqMultiSymbolBatchEnabled,
  setGroqMultiSymbolBatchResults,
} from "./ai-groq-multi-symbol.ts";
import {
  geminiAnalyzeMultiSymbol,
  readGeminiMultiSymbolBatchEnabled,
  setGeminiMultiSymbolBatchResults,
} from "./ai-gemini-multi-symbol.ts";
import {
  readGeminiCronSymbolGapMs,
  readSerialSymbolCyclesForGeminiQuota,
} from "./batch-validator.ts";

export async function handleAuthenticatedCron(
  supabase: ReturnType<typeof createClient>,
  symbols: string[],
  opts: { liteCycle?: boolean; trigger?: string } = {},
  lastAiPriceBySymbol: Map<string, number>,
): Promise<Response> {
  const startedAtMs = Date.now();
  const batchId = crypto.randomUUID();
  const liteCycle = Boolean(opts.liteCycle);
  clearCycleLogBuffer();
  try {
    const janitor = await tryRunCronJanitor({ supabase, symbols, batchId });
    if (janitor.blocked) return janitor.response;
    resetAiCycleGuards();
    const batchLlmPools = publishCronBatchLlmKeyPools(await fetchCronBatchLlmKeyPools());
    const geminiKeys = batchLlmPools.geminiSlots.map((s) => s.value).filter(Boolean);
    const tgChat = (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").trim() || (Deno.env.get("TELEGRAM_BOT_CHAT_ID") ?? "").trim();
    console.log("[INIT]:", {
      batch: batchId.slice(0, 8),
      n_symbols: symbols.length,
      lite_cycle: liteCycle ? 1 : 0,
      trigger: opts.trigger ?? "cron",
      bn: Number(!!Deno.env.get("BINANCE_API_KEY")),
      se: Number(!!Deno.env.get("SENTRY_DSN")),
      gm: geminiKeys.length,
      tg: Number(!!Deno.env.get("TELEGRAM_BOT_TOKEN")),
      tg_chat: Number(!!tgChat),
      bs: Number(!!Deno.env.get("BOT_SECRET")),
      llm_max_concurrent: readLlmMaxConcurrent(),
    });
    const telegramToken = (Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "").trim();
    const telegramChatId = (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").trim() || (Deno.env.get("TELEGRAM_BOT_CHAT_ID") ?? "").trim();
    if (!geminiKeys.length) {
      return jsonResponse({
        ok: false,
        error: "Missing Gemini credentials (set GEMINI_API_KEY and/or GEMINI_KEYS_POOL)",
        recovered: true,
        batch_id: batchId,
        hints: { telegram_token_configured: Boolean(telegramToken), telegram_chat_configured: Boolean(telegramChatId) },
      }, 200);
    }
    if (shouldLogCronBatchStartRow()) enqueueCycleLog({ level: "info", source: "runtime", message: "cron_batch_start", meta: { event: "cron_batch_start", batch_id: batchId, symbols, symbol_count: symbols.length } });
    const sharedMarketCache = new Map();
    const prefetchSymbols = [...new Set([...symbols.map((symbol) => normalizeSymbol(symbol, DEFAULT_SYMBOL)), "BTCUSDT"])];
    await Promise.all([
      Promise.all(prefetchSymbols.map((symbol) => safeExecute(`prefetch_market_${symbol}`, () => getCachedSnapshot(sharedMarketCache, symbol, fetchIndicatorSnapshot), null))),
      safeExecute("binance_time_sync", () => binanceTimeSyncCheck(), undefined),
    ]);
    botDebug("index", "time_sync_ok", { n_symbols: symbols.length, batchId, prefetch_symbols: prefetchSymbols.length });
    const btcOverbought = resolveBtcOverboughtFromMarketCache(sharedMarketCache);
    const groqPoolN = batchLlmPools.groqPlan.scanKeys.length;
    const gemPoolN = batchLlmPools.geminiSlots.filter((s) => s.value).length;
    console.log(
      `[cron] llm_key_pools groq=${groqPoolN} gemini=${gemPoolN} source_groq=${batchLlmPools.groqPlan.source} preemptive=${shouldPreemptiveRouteForSymbolIndex(0) ? 1 : 0}`,
    );
    if (readCronMathTraceTelegramEnabled()) {
      for (const s of symbols) {
        const sym = normalizeSymbol(s, DEFAULT_SYMBOL);
        const snap = sharedMarketCache.get(sym);
        if (!snap) continue;
        safeExecuteDetached(
          `math_trace_tg_${sym}`,
          () => sendCronMathTraceTelegram({ symbol: sym, snapshot: snap, batchId }),
          undefined,
        );
      }
    }
    /** One consolidated LLM scan for all symbols (disabled when per-symbol provider matrix is on). */
    if (symbols.length >= 2 && !readAiProviderMatrixEnabled()) {
      const rowHint = { is_live_trading_enabled: false, is_ghost_execution: false };
      const items: Array<{ symbol: string; data: unknown }> = [];
      for (const s of symbols) {
        const sym = normalizeSymbol(s, DEFAULT_SYMBOL);
        const snap = sharedMarketCache.get(sym);
        if (snap) {
          items.push({
            symbol: sym,
            data: buildPayload(snap, sym, rowHint, { omitAiScoringRubric: true }),
          });
        }
      }
      if (items.length >= 2) {
        const groqFirst = readAiPrimaryLlmIsGroq();
        if (!groqFirst && readGeminiMultiSymbolBatchEnabled()) {
          const gemKeys = geminiKeys;
          if (gemKeys.length) {
            try {
              const quota = await getAiQuotaState();
              const base = Number(quota?.current_gemini_key_index ?? 0);
              const n = gemKeys.length;
              const keyIdx = (base + 1) % n;
              const scanKey = (gemKeys[keyIdx] ?? "").trim();
              if (scanKey) {
                const map = await geminiAnalyzeMultiSymbol(scanKey, items);
                if (map.size) {
                  setGeminiMultiSymbolBatchResults(map);
                  await patchAiQuotaState({ current_gemini_key_index: keyIdx });
                  console.log(
                    `[cron] gemini_multi_symbol_batch ok keys=${[...map.keys()].join(",")} n=${map.size}`,
                  );
                }
              }
            } catch (e) {
              console.warn(
                `[cron] GEMINI_MULTI_SYMBOL_BATCH failed: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          }
        } else if (readGroqMultiSymbolBatchEnabled()) {
          const scanPool = batchLlmPools.groqPlan.scanKeys;
          if (scanPool.length) {
            try {
              const quota = await getAiQuotaState();
              const base = Number(quota?.current_groq_scan_key_index ?? 0);
              const n = scanPool.length;
              const keyIdx = (base + 1) % n;
              const scanKey = (scanPool[keyIdx] ?? "").trim();
              if (scanKey) {
                const map = await groqAnalyzeMultiSymbol(scanKey, items);
                if (map.size) {
                  setGroqMultiSymbolBatchResults(map);
                  await patchAiQuotaState({ current_groq_scan_key_index: keyIdx });
                  console.log(
                    `[cron] groq_multi_symbol_batch ok keys=${[...map.keys()].join(",")} n=${map.size}`,
                  );
                }
              }
            } catch (e) {
              console.warn(
                `[cron] GROQ_MULTI_SYMBOL_BATCH failed: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          }
        }
      }
    }
    const allActions: BotActionResult[] = [];
    const mergedTargets = new Map<string, { isLiveMode: boolean; hasPaperMode: boolean; symbols: Set<string> }>();
    let cycleEmergencyAbort = false;
    let totalMs = 0;
    let totalScanned = 0;
    const perSymbol: Array<{ symbol: string; ok: boolean; detail?: string; scanned?: number }> = [];
    const serialSymbolCycles = readSerialSymbolCyclesForGeminiQuota();
    const interSymbolGapMs = readGeminiCronSymbolGapMs();
    const matrixRouting = readAiProviderMatrixEnabled();
    if (serialSymbolCycles) {
      const parallelAccum = await runCronSymbolBatchesStaggeredParallel({
        supabase,
        symbols,
        lastAiPriceBySymbol,
        marketCache: sharedMarketCache,
        btcOverbought,
        batchId,
        interSymbolGapMs,
        matrixRouting,
        groqPoolN,
        gemPoolN,
      });
      mergeBalanceSyncTargets(mergedTargets, parallelAccum.mergedTargets);
      allActions.push(...parallelAccum.allActions);
      cycleEmergencyAbort = parallelAccum.cycleEmergencyAbort;
      totalMs = parallelAccum.totalMs;
      totalScanned = parallelAccum.totalScanned;
      perSymbol.push(...parallelAccum.perSymbol);
    } else {
      const symbolSettled = await Promise.allSettled(symbols.map(async (symbolFilter) => {
        const batchResult = await withTelegramCycleScope(null, () =>
          runSymbolBatch({
            supabase,
            symbolFilter,
            lastAiPriceBySymbol,
            marketCache: sharedMarketCache,
            btcOverbought,
          }),
        );
        return { symbol: symbolFilter, batchResult };
      }));
      for (let i = 0; i < symbolSettled.length; i += 1) {
        const sym = symbols[i] ?? DEFAULT_SYMBOL;
        const entry = symbolSettled[i];
        if (entry.status !== "fulfilled") {
          perSymbol.push({ symbol: sym, ok: false, detail: String(entry.reason) });
          enqueueCycleLog({ level: "error", source: "symbol-cycle", symbol: sym, message: "symbol_cycle_failed", meta: { event: "symbol_cycle_failed", detail: String(entry.reason), batch_id: batchId } });
          continue;
        }
        const r = entry.value.batchResult;
        mergeBalanceSyncTargets(mergedTargets, r.balanceSyncTargets);
        allActions.push(...r.actions);
        cycleEmergencyAbort ||= r.cycleEmergencyAbort;
        totalMs += r.allSettledElapsedMs;
        totalScanned += r.scanned;
        perSymbol.push({ symbol: entry.value.symbol, ok: true, scanned: r.scanned });
      }
    }
    if (totalScanned === 0) {
      recordCronCycleSummary({ at: new Date().toISOString(), trigger: opts.trigger ?? "cron", scanned: 0, actions: 0 });
      const totalExecutionMs = Date.now() - startedAtMs;
      const functionHealth = await safeExecute(
        "function_vitality",
        () => runFunctionVitalityCheck({ supabase, batchId, runDebugger: false }),
        null,
      );
      detachCronTailSideEffects({
        supabase,
        batchId,
        totalScanned: 0,
        totalExecutionMs,
        allActions: [],
        functionHealth,
      });
      return jsonResponse({ ok: true, skipped: true, message: "No active bot for requested symbol(s)", symbols, symbol_results: perSymbol, batch_id: batchId, execution_ms_total: totalExecutionMs, trigger: opts.trigger ?? "cron", lite_cycle: liteCycle, function_health: functionHealth });
    }
    await runPostBatchBalanceSync({ supabase, balanceSyncTargets: mergedTargets, fallbackSymbol: symbols[0] ?? DEFAULT_SYMBOL });
    if (readPaperWalletReconcileEnabled()) {
      const paperUserIds = [...mergedTargets.entries()]
        .filter(([, target]) => target.hasPaperMode)
        .map(([userId]) => userId);
      safeExecuteBackground(
        "paper_wallet_reconcile",
        () => reconcilePaperProfilesForUserIds(supabase, paperUserIds),
        null,
      );
    }
    const hasLiveTrading = [...mergedTargets.values()].some((t) => t.isLiveMode);
    recordCronCycleSummary({ at: new Date().toISOString(), trigger: opts.trigger ?? "cron", scanned: totalScanned, actions: allActions.length });
    const totalExecutionMs = Date.now() - startedAtMs;
    const functionHealth = await safeExecute(
      "function_vitality",
      () => runFunctionVitalityCheck({ supabase, batchId, runDebugger: false }),
      null,
    );
    detachCronTailSideEffects({
      supabase,
      batchId,
      totalScanned,
      totalExecutionMs,
      allActions,
      hasLiveTrading,
      functionHealth,
    });
    return jsonResponse({
      ok: true,
      batch_id: batchId,
      symbols,
      symbol_results: perSymbol,
      scanned: totalScanned,
      actions: allActions,
      emergencyAbort: cycleEmergencyAbort,
      cycle_duration_ms_total: totalMs,
      execution_ms_total: totalExecutionMs,
      trigger: opts.trigger ?? "cron",
      lite_cycle: liteCycle,
      function_health: functionHealth,
    });
  } finally {
    clearGroqMultiSymbolBatch();
    clearCronBatchLlmKeyPools();
  }
}
