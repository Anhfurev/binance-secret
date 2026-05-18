// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { DEFAULT_SYMBOL } from "./constants.ts";
import type { BotActionResult } from "./types.ts";
import { jsonResponse, normalizeSymbol } from "./utils.ts";
import { botDebug } from "./bot-debug.ts";
import {
  initBinanceTimeSyncForCron,
  isBinanceTimeCacheValid,
  requiresSignedBinanceRequests,
} from "./binance-time-cache.ts";
import { readLlmMaxConcurrent } from "./ai-llm-concurrency.ts";
import { resetAiCycleGuards } from "./index-ai.ts";
import { prefetchMarketIntoCache } from "./prefetch-market-stream.ts";
import { safeExecute, safeExecuteBackground, safeExecuteDetached } from "./safe-execute.ts";
import { detachCronTailSideEffects } from "./cron-tail-side-effects.ts";
import { runCronSymbolBatchesParallel } from "./cron-symbol-batches.ts";
import { mergeBalanceSyncTargets, runPostBatchBalanceSync, runSymbolBatch } from "./run-symbol-batch.ts";
import { readCronMathTraceTelegramEnabled, sendCronMathTraceTelegram } from "./telegram-math-trace.ts";
import { readPaperWalletReconcileEnabled, reconcilePaperProfilesForUserIds } from "./paper-wallet-reconcile.ts";
import { shouldLogCronBatchStartRow } from "./log-policy.ts";
import { clearCycleLogBuffer, enqueueCycleLog } from "./cycle-log-buffer.ts";
import { recordCronCycleSummary } from "./cron-runner-telemetry.ts";
import { tryRunCronJanitor } from "./cron-janitor.ts";
import { runFunctionVitalityCheck } from "./function-health.ts";
import { edgeWaitUntil } from "./edge-runtime.ts";
import { flushLlmBatchKeyRegistryToDatabase } from "./llm-batch-key-sync.ts";
import {
  clearCronBatchLlmKeyPools,
  hydrateCronLlmKeyPools,
  shouldPreemptiveRouteForSymbolIndex,
} from "./llm-key-preemptive-route.ts";
import { isCronLlmKeyPoolHydrated } from "./llm-key-pool.ts";
import { attachServerBackgroundLifeline } from "./server-lifecycle.ts";
import { resolveBtcOverboughtFromMarketCache } from "./market-anchor.ts";
import { getAiQuotaState, patchAiQuotaState } from "./ai-db.ts";
import { buildPayload } from "./ai-core.ts";
import { isSnapshotMathPrimedForLlm } from "./math-guard.ts";
import { readAiPrimaryLlmIsGroq } from "./ai-llm-route.ts";
import { readAiCascadePipelineEnabled } from "./ai-cascade-config.ts";
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

function edgeCycleAbortedResponse(
  batchId: string,
  opts: { liteCycle?: boolean; trigger?: string },
  startedAtMs: number,
): Response {
  return jsonResponse({
    ok: true,
    skipped: true,
    reason: "edge_cycle_aborted",
    batch_id: batchId,
    execution_ms_total: Date.now() - startedAtMs,
    trigger: opts.trigger ?? "cron",
    lite_cycle: Boolean(opts.liteCycle),
  });
}

export async function handleAuthenticatedCron(
  supabase: ReturnType<typeof createClient>,
  symbols: string[],
  opts: { liteCycle?: boolean; trigger?: string; signal?: AbortSignal } = {},
  lastAiPriceBySymbol: Map<string, number>,
): Promise<Response> {
  const startedAtMs = Date.now();
  const batchId = crypto.randomUUID();
  const liteCycle = Boolean(opts.liteCycle);
  const cycleSignal = opts.signal;
  clearCycleLogBuffer();
  try {
    if (cycleSignal?.aborted) return edgeCycleAbortedResponse(batchId, opts, startedAtMs);
    const janitor = await tryRunCronJanitor({ supabase, symbols, batchId });
    if (janitor.blocked) return janitor.response;

    const poolPublish = await hydrateCronLlmKeyPools(batchId);
    if (!poolPublish.hydrated || !isCronLlmKeyPoolHydrated(batchId)) {
      console.error(
        `[cron] llm_key_pool hydration failed gemini=${poolPublish.geminiRegistered} groq=${poolPublish.groqRegistered}`,
      );
      return jsonResponse({
        ok: false,
        error: "llm_key_pool_not_hydrated",
        batch_id: batchId,
        hydrated: false,
        gemini_registered: poolPublish.geminiRegistered,
        groq_registered: poolPublish.groqRegistered,
      }, 503);
    }

    const batchLlmPools = poolPublish.pools;
    resetAiCycleGuards();
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
    attachServerBackgroundLifeline(prefetchSymbols);
    const timeSyncColdBlock =
      requiresSignedBinanceRequests() && !isBinanceTimeCacheValid();
    const timeSyncWork = safeExecute(
      "binance_time_sync",
      () => initBinanceTimeSyncForCron(),
      { serverTime: Date.now(), driftMs: 0, fromCache: true, coldBoot: false, blockedSync: false },
    );
    if (!timeSyncColdBlock) {
      void timeSyncWork;
    }
    await safeExecute(
      "prefetch_market_stream_bulk",
      () => prefetchMarketIntoCache(sharedMarketCache, prefetchSymbols, cycleSignal),
      { streamHits: 0, restFallbacks: 0 },
    );
    if (timeSyncColdBlock) {
      await timeSyncWork;
    }
    if (cycleSignal?.aborted) return edgeCycleAbortedResponse(batchId, opts, startedAtMs);
    botDebug("index", "time_sync_ok", { n_symbols: symbols.length, batchId, prefetch_symbols: prefetchSymbols.length });
    const btcOverbought = resolveBtcOverboughtFromMarketCache(sharedMarketCache);
    const groqPoolN = batchLlmPools.groqPlan.scanKeys.length;
    const gemPoolN = batchLlmPools.geminiSlots.filter((s) => s.value).length;
    console.log(
      `[cron] llm_key_pools groq=${groqPoolN} gemini=${gemPoolN} source_groq=${batchLlmPools.groqPlan.source} db_hard_timeout=${batchLlmPools.groqPlan.useDbHardTimeout ? 1 : 0} merge_env=${String(Deno.env.get("LLM_API_KEYS_MERGE_ENV") ?? "1")} fetch_max=${String(Deno.env.get("LLM_API_KEYS_FETCH_MAX") ?? "64")} preemptive=${shouldPreemptiveRouteForSymbolIndex(0) ? 1 : 0}`,
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
    /** One consolidated LLM scan (disabled for 3-tier cascade and per-symbol provider matrix). */
    if (
      symbols.length >= 2 &&
      !readAiCascadePipelineEnabled() &&
      !readAiProviderMatrixEnabled() &&
      !cycleSignal?.aborted
    ) {
      const rowHint = { is_live_trading_enabled: false, is_ghost_execution: false };
      const items: Array<{ symbol: string; data: unknown }> = [];
      let batchMathSkipped = 0;
      for (const s of symbols) {
        const sym = normalizeSymbol(s, DEFAULT_SYMBOL);
        const snap = sharedMarketCache.get(sym);
        if (!snap) continue;
        if (!isSnapshotMathPrimedForLlm(snap, { paperExploration: false, botSettings: rowHint })) {
          batchMathSkipped += 1;
          console.log(
            `[SKIPPING] Math says NO BUY for ${sym}. Bypassing AI call to save tokens. (cron_multi_symbol_batch)`,
          );
          continue;
        }
        items.push({
          symbol: sym,
          data: buildPayload(snap, sym, rowHint, { omitAiScoringRubric: true }),
        });
      }
      if (batchMathSkipped > 0) {
        console.log(`[cron] multi_symbol_batch math_guard skipped=${batchMathSkipped}`);
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
    const matrixRouting = readAiProviderMatrixEnabled();
    const parallelAccum = await runCronSymbolBatchesParallel({
      supabase,
      symbols,
      lastAiPriceBySymbol,
      marketCache: sharedMarketCache,
      btcOverbought,
      batchId,
      matrixRouting,
      groqPoolN,
      gemPoolN,
      signal: cycleSignal,
    });
    mergeBalanceSyncTargets(mergedTargets, parallelAccum.mergedTargets);
    allActions.push(...parallelAccum.allActions);
    cycleEmergencyAbort = parallelAccum.cycleEmergencyAbort;
    totalMs = parallelAccum.totalMs;
    totalScanned = parallelAccum.totalScanned;
    perSymbol.push(...parallelAccum.perSymbol);
    if (cycleSignal?.aborted) return edgeCycleAbortedResponse(batchId, opts, startedAtMs);
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
      status: "success",
      batch: batchId,
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
  } catch (error) {
    if (
      cycleSignal?.aborted
      || (error instanceof DOMException && error.name === "AbortError")
    ) {
      return edgeCycleAbortedResponse(batchId, opts, startedAtMs);
    }
    throw error;
  } finally {
    edgeWaitUntil(
      (async () => {
        await flushLlmBatchKeyRegistryToDatabase();
        clearGroqMultiSymbolBatch();
        clearCronBatchLlmKeyPools(batchId);
      })().catch((err) => {
        console.warn(
          `[cron] post_response_cleanup: ${err instanceof Error ? err.message : String(err)}`,
        );
      }),
    );
  }
}
