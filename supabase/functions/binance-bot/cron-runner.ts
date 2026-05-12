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
import { safeExecute } from "./safe-execute.ts";
import { mergeBalanceSyncTargets, runPostBatchBalanceSync, runSymbolBatch } from "./run-symbol-batch.ts";
import { maybeHandleTelegramWalletStatusCommand } from "./telegram-wallet-status.ts";
import { maybeSendCronDigestTelegram } from "./cron-telegram-digest.ts";
import { readPaperWalletReconcileEnabled, reconcilePaperProfilesForUserIds } from "./paper-wallet-reconcile.ts";
import { shouldLogCronBatchStartRow } from "./log-policy.ts";
import { maybeRunScheduledDebugger } from "./debugger-auto-run.ts";
import { clearCycleLogBuffer, enqueueCycleLog, flushCycleLogs } from "./cycle-log-buffer.ts";
import { emitLatencyTelemetry, maybeSendFourHourOpsHeartbeat, recordCronCycleSummary, resolveAnyLiveAutopilot } from "./cron-runner-telemetry.ts";
import { tryRunCronJanitor } from "./cron-janitor.ts";

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
    const tgChat = (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").trim() || (Deno.env.get("TELEGRAM_BOT_CHAT_ID") ?? "").trim();
    console.log("[INIT]:", { batch: batchId.slice(0, 8), n_symbols: symbols.length, lite_cycle: liteCycle ? 1 : 0, trigger: opts.trigger ?? "cron", bn: Number(!!Deno.env.get("BINANCE_API_KEY")), se: Number(!!Deno.env.get("SENTRY_DSN")), gm: Number(!!Deno.env.get("GEMINI_API_KEY")), tg: Number(!!Deno.env.get("TELEGRAM_BOT_TOKEN")), tg_chat: Number(!!tgChat), bs: Number(!!Deno.env.get("BOT_SECRET")), llm_max_concurrent: readLlmMaxConcurrent() });
    const janitor = await tryRunCronJanitor({ supabase, symbols, batchId });
    if (janitor.blocked) return janitor.response;
    const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
    const telegramToken = (Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "").trim();
    const telegramChatId = (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").trim() || (Deno.env.get("TELEGRAM_BOT_CHAT_ID") ?? "").trim();
    if (!geminiKey.trim()) return jsonResponse({ ok: false, error: "Missing GEMINI_API_KEY", recovered: true, batch_id: batchId, hints: { telegram_token_configured: Boolean(telegramToken), telegram_chat_configured: Boolean(telegramChatId) } }, 200);
    if (shouldLogCronBatchStartRow()) enqueueCycleLog({ level: "info", source: "runtime", message: "cron_batch_start", meta: { event: "cron_batch_start", batch_id: batchId, symbols, symbol_count: symbols.length } });
    const sharedMarketCache = new Map();
    const prefetchSymbols = [...new Set([...symbols.map((symbol) => normalizeSymbol(symbol, DEFAULT_SYMBOL)), "BTCUSDT"])];
    await Promise.all([
      Promise.all(prefetchSymbols.map((symbol) => safeExecute(`prefetch_market_${symbol}`, () => getCachedSnapshot(sharedMarketCache, symbol, fetchIndicatorSnapshot), null))),
      safeExecute("binance_time_sync", () => binanceTimeSyncCheck(), undefined),
    ]);
    botDebug("index", "time_sync_ok", { n_symbols: symbols.length, batchId, prefetch_symbols: prefetchSymbols.length });
    resetAiCycleGuards();
    const allActions: BotActionResult[] = [];
    const mergedTargets = new Map<string, { isLiveMode: boolean; symbols: Set<string> }>();
    let cycleEmergencyAbort = false;
    let totalMs = 0;
    let totalScanned = 0;
    const perSymbol: Array<{ symbol: string; ok: boolean; detail?: string; scanned?: number }> = [];
    const symbolSettled = await Promise.allSettled(symbols.map(async (symbolFilter) => {
      const batchResult = await withTelegramCycleScope(null, () => runSymbolBatch({ supabase, symbolFilter, lastAiPriceBySymbol, marketCache: sharedMarketCache }));
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
    if (totalScanned === 0) {
      recordCronCycleSummary({ at: new Date().toISOString(), trigger: opts.trigger ?? "cron", scanned: 0, actions: 0 });
      await maybeSendFourHourOpsHeartbeat(supabase, { hasLiveTrading: await resolveAnyLiveAutopilot(supabase) });
      await safeExecute("scheduled_debugger", () => maybeRunScheduledDebugger(supabase, batchId), null);
      const totalExecutionMs = Date.now() - startedAtMs;
      emitLatencyTelemetry({ batchId, totalExecutionMs });
      return jsonResponse({ ok: true, skipped: true, message: "No active bot for requested symbol(s)", symbols, symbol_results: perSymbol, batch_id: batchId, execution_ms_total: totalExecutionMs, trigger: opts.trigger ?? "cron", lite_cycle: liteCycle });
    }
    await runPostBatchBalanceSync({ supabase, balanceSyncTargets: mergedTargets, fallbackSymbol: symbols[0] ?? DEFAULT_SYMBOL });
    if (readPaperWalletReconcileEnabled()) {
      const paperUserIds = [...mergedTargets.entries()].filter(([, target]) => !target.isLiveMode).map(([userId]) => userId);
      await safeExecute("paper_wallet_reconcile", () => reconcilePaperProfilesForUserIds(supabase, paperUserIds), null);
    }
    const hasLiveTrading = [...mergedTargets.values()].some((t) => t.isLiveMode);
    recordCronCycleSummary({ at: new Date().toISOString(), trigger: opts.trigger ?? "cron", scanned: totalScanned, actions: allActions.length });
    await maybeSendFourHourOpsHeartbeat(supabase, { hasLiveTrading });
    await safeExecute("scheduled_debugger", () => maybeRunScheduledDebugger(supabase, batchId), null);
    const totalExecutionMs = Date.now() - startedAtMs;
    emitLatencyTelemetry({ batchId, totalExecutionMs });
    await safeExecute("telegram_wallet_status_side_effects", () => maybeHandleTelegramWalletStatusCommand(supabase), undefined);
    void maybeSendCronDigestTelegram({ supabase, batchId, totalScanned, totalExecutionMs, allActions });
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
    });
  } finally {
    await flushCycleLogs(supabase);
  }
}
