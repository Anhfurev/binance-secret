// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  DEFAULT_SYMBOL,
  SERVICE_ROLE_KEY,
  SUPABASE_URL,
} from "./constants.ts";
import type { BotActionResult } from "./types.ts";
import {
  formatUnknownError,
  jsonResponse,
  normalizeSymbol,
  safeReadJsonBody,
  toStringValue,
} from "./utils.ts";
import {
  botDebug,
  botError,
  botWarn,
  emitSentryBootProbe,
  emitSentryFatalException,
} from "./bot-debug.ts";
import {
  binanceTimeSyncCheck,
  fetchIndicatorSnapshot,
  getTotalAccountBalanceUsdt,
} from "./binance.ts";
import { readLlmMaxConcurrent } from "./ai-llm-concurrency.ts";
import { getCachedSnapshot, resetAiCycleGuards } from "./index-ai.ts";
import { escapeHtml, withTelegramCycleScope } from "./bot-shared.ts";
import { isTransientPostgrestError } from "./postgrest-errors.ts";
import { safeExecute } from "./safe-execute.ts";
import {
  mergeBalanceSyncTargets,
  runPostBatchBalanceSync,
  runSymbolBatch,
} from "./run-symbol-batch.ts";
import { sendTelegramAlert } from "./notifier.ts";
import { maybeHandleTelegramWalletStatusCommand } from "./telegram-wallet-status.ts";
import { maybeSendCronDigestTelegram } from "./cron-telegram-digest.ts";
import { shouldLogCronBatchStartRow } from "./log-policy.ts";
import {
  collectHealthSnapshot,
  type RetentionRunResult,
  runRetentionCleanup,
  runStaleTradeGuard,
} from "./health-check.ts";
import { runDebuggerHealthAndFix } from "./health-debugger.ts";
import { handleMaintenanceOnly } from "./index-maintenance.ts";
import {
  clearCycleLogBuffer,
  enqueueCycleLog,
  flushCycleLogs,
} from "./cycle-log-buffer.ts";

const lastAiPriceBySymbol = new Map<string, number>();

/** One Supabase client per warm isolate (service role; no per-request allocation). */
const sharedSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const FOUR_HOUR_MS = 4 * 60 * 60 * 1000;
const LATENCY_WARN_THROTTLE_MS = 5 * 60 * 1000;
const LATENCY_WARN_THRESHOLD_MS = 15_000;
/**
 * Hard ceiling for the entire edge invocation. Platform kills at ~150s; we cap
 * earlier to guarantee a 200 response and prevent cron pile-up that overloads
 * the DB. Tunable via EDGE_GLOBAL_TIMEOUT_MS (clamped 30s..120s).
 */
function readEdgeGlobalTimeoutMs(): number {
  const raw = String(Deno.env.get("EDGE_GLOBAL_TIMEOUT_MS") ?? "").trim();
  const n = raw.length ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 90_000;
  return Math.min(120_000, Math.max(30_000, Math.floor(n)));
}
const EDGE_GLOBAL_TIMEOUT_MS = readEdgeGlobalTimeoutMs();
let lastFourHourOpsHeartbeatAt = 0;
let lastLatencyAlertAtMs = 0;
/**
 * In-isolate cycle gate. Prevents cron pile-up: if a previous cycle is still
 * running in this warm isolate, the new request returns immediately with a
 * skip response instead of stacking and starving the DB.
 */
let inFlightCycleStartedAt: number | null = null;
async function resolveAnyLiveAutopilot(
  supabase: ReturnType<typeof createClient>,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("bot_settings")
    .select("id", { count: "exact", head: true })
    .eq("is_autopilot_enabled", true)
    .eq("is_live_trading_enabled", true);
  if (error) return false;
  return Number(count ?? 0) > 0;
}

/**
 * Telegram ops heartbeat: balance snapshot, open trade count, reserved USDT.
 * Throttled to once per 4 hours (independent of trade activity).
 */
async function maybeSendFourHourOpsHeartbeat(
  supabase: ReturnType<typeof createClient>,
  opts: { hasLiveTrading: boolean },
) {
  const now = Date.now();
  if (now - lastFourHourOpsHeartbeatAt < FOUR_HOUR_MS) return;

  try {
    let accountLine = "";
    if (opts.hasLiveTrading) {
      try {
        const live = await getTotalAccountBalanceUsdt(false);
        accountLine = `<b>Account balance</b> (Binance net USDT est.): ${
          escapeHtml(
            Number.isFinite(live) && live > 0 ? live.toFixed(2) : "n/a",
          )
        }`;
      } catch (error) {
        await safeExecute(
          "catch_heartbeat_balance_fetch_failed_log",
          () =>
            supabase.from("logs").insert([{
              level: "warn",
              source: "ops-heartbeat",
              message: "heartbeat_balance_fetch_failed",
              meta: {
                event: "heartbeat_balance_fetch_failed",
                detail: formatUnknownError(error),
              },
              created_at: new Date().toISOString(),
            }]),
          undefined,
        );
        accountLine = "<b>Account balance</b>: unavailable (Binance fetch failed)";
      }
    } else {
      accountLine =
        "<b>Account balance</b>: paper / demo — live Binance total not requested for this heartbeat";
    }

    const openRes = await supabase
      .from("trades")
      .select("id", { count: "exact", head: true })
      .ilike("status", "open");
    const openTrades = Number(openRes.count ?? 0);

    const { data: resRows, error: resErr } = await supabase
      .from("capital_reservations")
      .select("requested_usd");
    let reserved = 0;
    if (!resErr && Array.isArray(resRows)) {
      reserved = resRows.reduce(
        (a: number, r: { requested_usd?: number }) => a + Number(r?.requested_usd ?? 0),
        0,
      );
    }

    await sendTelegramAlert(
      `💓 <b>HEARTBEAT</b> <i>(4h schedule)</i>\n` +
        `${accountLine}\n` +
        `<b>Open trades</b>: ${openTrades}\n` +
        `<b>Reserved capital</b>: ${escapeHtml(reserved.toFixed(4))} USDT`,
    );
    lastFourHourOpsHeartbeatAt = Date.now();
  } catch (error) {
    botDebug("index", "four_hour_heartbeat_failed", {
      detail: formatUnknownError(error),
    });
    await safeExecute(
      "catch_four_hour_heartbeat_failed_log",
      () =>
        supabase.from("logs").insert([{
          level: "error",
          source: "ops-heartbeat",
          message: "four_hour_heartbeat_failed",
          meta: {
            event: "four_hour_heartbeat_failed",
            detail: formatUnknownError(error),
          },
          created_at: new Date().toISOString(),
        }]),
      undefined,
    );
  }
}

function parseSymbolsFromBody(
  parsedBody: Record<string, unknown> | null,
  searchParams?: URLSearchParams,
): string[] {
  const rawList = parsedBody?.symbols;
  if (Array.isArray(rawList)) {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of rawList) {
      const s = toStringValue(item);
      if (!s) continue;
      const n = normalizeSymbol(s, DEFAULT_SYMBOL);
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  }
  const single =
    toStringValue(parsedBody?.symbol) ?? toStringValue(parsedBody?.ticker);
  if (single) return [normalizeSymbol(single, DEFAULT_SYMBOL)];
  if (searchParams) {
    const q =
      toStringValue(searchParams.get("symbol")) ??
      toStringValue(searchParams.get("ticker"));
    if (q) return [normalizeSymbol(q, DEFAULT_SYMBOL)];
  }
  return [];
}

function truthyTradingViewFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes";
  }
  return false;
}

function isTradingViewWebhookRequest(
  parsedBody: Record<string, unknown> | null,
  url: URL,
): boolean {
  if (url.searchParams.get("tv_webhook") === "1") return true;
  return truthyTradingViewFlag(parsedBody?.tradingview_webhook);
}

function resolveTradingViewAuth(
  parsedBody: Record<string, unknown> | null,
  url: URL,
): { ok: boolean; providedTvSecret: string } {
  const env = (Deno.env.get("TRADINGVIEW_WEBHOOK_SECRET") ?? "").trim();
  if (!env) return { ok: false, providedTvSecret: "" };
  const fromBody = toStringValue(parsedBody?.tv_secret);
  const fromQuery = toStringValue(url.searchParams.get("tv_secret"));
  const provided = (fromBody ?? fromQuery ?? "").trim();
  return { ok: provided === env && provided.length > 0, providedTvSecret: provided };
}

function emitLatencyTelemetry(params: { batchId: string; totalExecutionMs: number }) {
  const { batchId, totalExecutionMs } = params;
  console.log(
    `[LATENCY] batch=${batchId} total_execution_ms=${totalExecutionMs} threshold_warn_ms=${LATENCY_WARN_THRESHOLD_MS}`,
  );
  if (totalExecutionMs <= LATENCY_WARN_THRESHOLD_MS) return;
  const now = Date.now();
  if (now - lastLatencyAlertAtMs < LATENCY_WARN_THROTTLE_MS) return;
  lastLatencyAlertAtMs = now;
  // Fire-and-forget: do not block the response on a Telegram round-trip when
  // the cycle is already approaching the platform timeout budget.
  void sendTelegramAlert(
    `⚠️ <b>LATENCY WARNING</b>\n` +
      `<b>batch</b>: <code>${escapeHtml(batchId)}</code>\n` +
      `<b>duration_ms</b>: ${totalExecutionMs}\n` +
      `<b>threshold_ms</b>: ${LATENCY_WARN_THRESHOLD_MS}\n` +
      `Early warning before platform timeout threshold.`,
  );
}

async function persistEdgeFatalLog(
  supabase: ReturnType<typeof createClient> | null,
  message: string,
  meta: Record<string, unknown> = {},
  level: "error" | "warn" = "error",
) {
  if (!supabase) return;
  try {
    await supabase.from("logs").insert([{
      level,
      source: "edge-fatal",
      message: message.slice(0, 500),
      meta: { event: "edge_fatal", ...meta },
      created_at: new Date().toISOString(),
    }]);
  } catch (e) {
    console.error(`[binance-bot] persistEdgeFatalLog: ${String(e)}`);
    await safeExecute(
      "catch_persist_edge_fatal_log_failed",
      () =>
        supabase.from("logs").insert([{
          level: "error",
          source: "edge-fatal",
          message: "persist_edge_fatal_log_failed",
          meta: {
            event: "persist_edge_fatal_log_failed",
            detail: formatUnknownError(e),
          },
          created_at: new Date().toISOString(),
        }]),
      undefined,
    );
  }
}

async function handleHealthCheckOnly(
  supabase: ReturnType<typeof createClient>,
): Promise<Response> {
  const startedAtMs = Date.now();
  const batchId = `health-${crypto.randomUUID().slice(0, 8)}`;
  console.log("[HEALTH] starting health_check_only", { batchId });

  const [snapshot, staleResult, retentionResult] = await Promise.all([
    safeExecute("health_snapshot", () => collectHealthSnapshot({ supabase }), null),
    safeExecute("health_stale_guard", () => runStaleTradeGuard({ supabase, batchId }), null),
    safeExecute(
      "health_retention",
      () => runRetentionCleanup({ supabase, batchId, force: true }),
      null,
    ),
  ]);

  return jsonResponse({
    ok: true,
    mode: "health_check_only",
    batch_id: batchId,
    elapsed_ms: Date.now() - startedAtMs,
    snapshot,
    stale_trade_guard: staleResult,
    retention_cleanup: retentionResult,
  });
}

async function handleDebuggerHealthOnly(
  supabase: ReturnType<typeof createClient>,
  applyFixes: boolean,
  includeRetention: boolean,
): Promise<Response> {
  const startedAtMs = Date.now();
  const batchId = `debug-${crypto.randomUUID().slice(0, 8)}`;
  console.log("[DEBUGGER] starting debugger_health_only", {
    batchId,
    applyFixes,
    includeRetention,
  });

  // Serialized — parallel snapshot + stale guard + debugger still spikes CPU/RAM on
  // Edge (WORKER_RESOURCE_LIMIT). Cron keeps normal throughput; this endpoint favors reliability.
  const snapshot = await safeExecute(
    "debug_health_snapshot",
    () => collectHealthSnapshot({ supabase }),
    null,
  );
  const staleResult = await safeExecute(
    "debug_stale_guard",
    () => runStaleTradeGuard({ supabase, batchId }),
    null,
  );
  const debuggerResult = await safeExecute(
    "debugger_health",
    () => runDebuggerHealthAndFix({ supabase, batchId, applyFixes }),
    null,
  );

  let retentionResult: RetentionRunResult | null = null;
  if (includeRetention) {
    retentionResult = await safeExecute(
      "debug_retention",
      () => runRetentionCleanup({ supabase, batchId, force: true }),
      null,
    );
  }

  return jsonResponse({
    ok: true,
    mode: "debugger_health_only",
    batch_id: batchId,
    elapsed_ms: Date.now() - startedAtMs,
    debugger: debuggerResult,
    snapshot,
    stale_trade_guard: staleResult,
    retention_cleanup: retentionResult,
    retention_included: includeRetention,
  });
}

async function handleAuthenticatedCron(
  supabase: ReturnType<typeof createClient>,
  symbols: string[],
  opts: { liteCycle?: boolean; trigger?: string } = {},
): Promise<Response> {
  const startedAtMs = Date.now();
  const batchId = crypto.randomUUID();
  const liteCycle = Boolean(opts.liteCycle);
  clearCycleLogBuffer();
  try {

  const tgChat =
    (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").trim() ||
    (Deno.env.get("TELEGRAM_BOT_CHAT_ID") ?? "").trim();
  console.log("[INIT]:", {
    batch: batchId.slice(0, 8),
    n_symbols: symbols.length,
    lite_cycle: liteCycle ? 1 : 0,
    trigger: opts.trigger ?? "cron",
    bn: Number(!!Deno.env.get("BINANCE_API_KEY")),
    se: Number(!!Deno.env.get("SENTRY_DSN")),
    gm: Number(!!Deno.env.get("GEMINI_API_KEY")),
    tg: Number(!!Deno.env.get("TELEGRAM_BOT_TOKEN")),
    tg_chat: Number(!!tgChat),
    bs: Number(!!Deno.env.get("BOT_SECRET")),
    llm_max_concurrent: readLlmMaxConcurrent(),
  });

  try {
    const { data: globalStopRows, error: globalStopError } = await supabase
      .from("profiles")
      .select("id,global_stop")
      .eq("global_stop", true)
      .limit(1);
    if (globalStopError) throw globalStopError;
    if ((globalStopRows ?? []).length > 0) {
      const stopRow = (globalStopRows ?? [])[0] as Record<string, unknown>;
      botDebug("index", "global_stop_active", {
        n_symbols: symbols.length,
        profile_id: toStringValue(stopRow?.id),
      });
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: "global_stop_enabled",
        batch_id: batchId,
      });
    }
  } catch (error) {
    const detail = formatUnknownError(error);
    if (detail.includes("profiles.global_stop")) {
      botDebug("index", "global_stop_column_missing", { n_symbols: symbols.length, detail });
      await safeExecute(
        "catch_global_stop_column_missing_log",
        () =>
          supabase.from("logs").insert([{
            level: "warn",
            source: "runtime",
            message: "global_stop_column_missing",
            meta: {
              event: "global_stop_column_missing",
              detail,
            },
            created_at: new Date().toISOString(),
          }]),
        undefined,
      );
    } else {
      throw error;
    }
  }

  const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  const telegramToken = (Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "").trim();
  const telegramChatId =
    (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").trim() ||
    (Deno.env.get("TELEGRAM_BOT_CHAT_ID") ?? "").trim();
  /** AI path requires Gemini; Telegram is optional (alerts no-op if unset). */
  if (!geminiKey.trim()) {
    return jsonResponse(
      {
        ok: false,
        error: "Missing GEMINI_API_KEY",
        recovered: true,
        batch_id: batchId,
        hints: {
          telegram_token_configured: Boolean(telegramToken),
          telegram_chat_configured: Boolean(telegramChatId),
        },
      },
      200,
    );
  }
  if (!telegramToken || !telegramChatId) {
    console.warn(
      "[binance-bot] Telegram secrets incomplete — alerts disabled until TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (or TELEGRAM_BOT_CHAT_ID) are set on this Edge function.",
    );
  }

  if (shouldLogCronBatchStartRow()) {
    enqueueCycleLog({
      level: "info",
      source: "runtime",
      message: "cron_batch_start",
      meta: {
        event: "cron_batch_start",
        batch_id: batchId,
        symbols,
        symbol_count: symbols.length,
      },
    });
  }

  const sharedMarketCache = new Map();
  const prefetchSymbols = [
    ...new Set([
      ...symbols.map((symbol) => normalizeSymbol(symbol, DEFAULT_SYMBOL)),
      "BTCUSDT",
    ]),
  ];
  await Promise.all([
    Promise.all(
      prefetchSymbols.map((symbol) =>
        safeExecute(
          `prefetch_market_${symbol}`,
          () => getCachedSnapshot(sharedMarketCache, symbol, fetchIndicatorSnapshot),
          null,
        )
      ),
    ),
    safeExecute("binance_time_sync", () => binanceTimeSyncCheck(), undefined),
  ]);
  botDebug("index", "time_sync_ok", {
    n_symbols: symbols.length,
    batchId,
    prefetch_symbols: prefetchSymbols.length,
  });

  resetAiCycleGuards();

  const allActions: BotActionResult[] = [];
  const mergedTargets = new Map<string, { isLiveMode: boolean; symbols: Set<string> }>();
  let cycleEmergencyAbort = false;
  let totalMs = 0;
  let totalScanned = 0;
  const perSymbol: Array<{ symbol: string; ok: boolean; detail?: string; scanned?: number }> =
    [];

  const symbolSettled = await Promise.allSettled(symbols.map(async (symbolFilter) => {
    console.log(`[${batchId}] ⏳ Processing ${symbolFilter} (parallel symbol batch)`);
    const batchResult = await withTelegramCycleScope(null, () =>
      runSymbolBatch({
        supabase,
        symbolFilter,
        lastAiPriceBySymbol,
        marketCache: sharedMarketCache,
      }));
    console.log(
      `[MEMORY] ${symbolFilter} done. Heap: ${Math.round(Deno.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    );
    return { symbol: symbolFilter, batchResult };
  }));
  const symbolResults: Array<
    | { symbol: string; ok: true; batchResult: Awaited<ReturnType<typeof runSymbolBatch>> }
    | { symbol: string; ok: false; detail: string }
  > = [];
  for (let i = 0; i < symbolSettled.length; i += 1) {
    const sym = symbols[i] ?? DEFAULT_SYMBOL;
    const entry = symbolSettled[i];
    if (entry.status === "fulfilled") {
      symbolResults.push({ symbol: entry.value.symbol, ok: true, batchResult: entry.value.batchResult });
      continue;
    }
    const detail = formatUnknownError(entry.reason);
    const msg = entry.reason instanceof Error ? entry.reason.message : detail;
    console.error(`❌ Error in ${sym} cycle:`, msg);
    enqueueCycleLog({
      level: "error",
      source: "symbol-cycle",
      symbol: sym,
      message: "symbol_cycle_failed",
      meta: {
        event: "symbol_cycle_failed",
        detail,
        batch_id: batchId,
      },
    });
    symbolResults.push({ symbol: sym, ok: false, detail });
  }
  for (const r of symbolResults) {
    if (r.ok) {
      mergeBalanceSyncTargets(mergedTargets, r.batchResult.balanceSyncTargets);
      allActions.push(...r.batchResult.actions);
      cycleEmergencyAbort ||= r.batchResult.cycleEmergencyAbort;
      totalMs += r.batchResult.allSettledElapsedMs;
      totalScanned += r.batchResult.scanned;
      perSymbol.push({ symbol: r.symbol, ok: true, scanned: r.batchResult.scanned });
    } else {
      perSymbol.push({ symbol: r.symbol, ok: false, detail: r.detail });
    }
  }

  if (totalScanned === 0) {
    await maybeSendFourHourOpsHeartbeat(supabase, {
      hasLiveTrading: await resolveAnyLiveAutopilot(supabase),
    });
    console.log("[MEMORY]", Deno.memoryUsage());
    const totalExecutionMs = Date.now() - startedAtMs;
    emitLatencyTelemetry({ batchId, totalExecutionMs });
    return jsonResponse({
      ok: true,
      skipped: true,
      message: "No active bot for requested symbol(s)",
      symbols,
      symbol_results: perSymbol,
      batch_id: batchId,
      execution_ms_total: totalExecutionMs,
      trigger: opts.trigger ?? "cron",
      lite_cycle: liteCycle,
    });
  }

  await runPostBatchBalanceSync({
    supabase,
    balanceSyncTargets: mergedTargets,
    fallbackSymbol: symbols[0] ?? DEFAULT_SYMBOL,
  });

  const hasLiveTrading = [...mergedTargets.values()].some((t) => t.isLiveMode);
  await maybeSendFourHourOpsHeartbeat(supabase, { hasLiveTrading });

  console.log("[MEMORY]", Deno.memoryUsage());
  const totalExecutionMs = Date.now() - startedAtMs;
  emitLatencyTelemetry({ batchId, totalExecutionMs });

  await safeExecute(
    "telegram_wallet_status_side_effects",
    () => maybeHandleTelegramWalletStatusCommand(supabase),
    undefined,
  );

  void maybeSendCronDigestTelegram({
    supabase,
    batchId,
    totalScanned,
    totalExecutionMs,
    allActions,
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
  });
  } finally {
    await flushCycleLogs(supabase);
  }
}

Deno.serve(async (req: Request) => {
  console.log("🚀 [EDGE] Function entry point hit.");
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type, x-binance-bot-secret",
      },
    });
  }

  const supabaseForFatal: ReturnType<typeof createClient> | null = sharedSupabase;
  try {
    const requestUrl = new URL(req.url);
    let parsedBody = await safeReadJsonBody(req) as Record<string, unknown> | null;
    if ((parsedBody as any)?._invalidJson) {
      const qSym =
        toStringValue(requestUrl.searchParams.get("symbol")) ??
        toStringValue(requestUrl.searchParams.get("ticker"));
      const tvQuery = requestUrl.searchParams.get("tv_webhook") === "1";
      if (!(tvQuery && qSym)) {
        return jsonResponse(
          {
            ok: false,
            error: "Invalid JSON body",
            detail: "Request body is not valid JSON",
          },
          400,
        );
      }
      parsedBody = {};
    }
    const symbols = parseSymbolsFromBody(parsedBody, requestUrl.searchParams);
    const probeSymbol = symbols[0] ?? "unknown";
    const healthCheckOnly = Boolean((parsedBody as any)?.health_check_only);
    const maintenanceOnly = Boolean((parsedBody as any)?.maintenance_only);
    const debuggerHealthOnly = Boolean((parsedBody as any)?.debugger_health_only);
    const debuggerApplyFixes = (parsedBody as any)?.debugger_apply_fixes !== false;
    const debuggerIncludeRetention = Boolean((parsedBody as any)?.debugger_include_retention);

    botDebug("index", "function_started", {
      method: req.method,
      sym: probeSymbol,
      n_symbols: symbols.length,
      health_check_only: healthCheckOnly,
      maintenance_only: maintenanceOnly,
      debugger_health_only: debuggerHealthOnly,
      debugger_apply_fixes: debuggerApplyFixes,
      debugger_include_retention: debuggerIncludeRetention,
    });
    void emitSentryBootProbe({ method: req.method, symbol: probeSymbol });

    const botSecret = (Deno.env.get("BOT_SECRET") ?? "").trim();
    const providedSecret = (req.headers.get("x-binance-bot-secret") ?? "").trim();
    const tvWant = isTradingViewWebhookRequest(parsedBody, requestUrl);
    const tvAuth = resolveTradingViewAuth(parsedBody, requestUrl);
    const botAuthed = Boolean(botSecret && providedSecret && providedSecret === botSecret);
    const tvAuthed = Boolean(tvWant && tvAuth.ok);

    if (!botSecret) {
      botDebug("index", "unauthorized_bot_secret_unset", { symbol: probeSymbol });
      return jsonResponse(
        {
          ok: false,
          error: "Unauthorized",
          detail:
            "BOT_SECRET is not set on the binance-bot Edge function (Dashboard → Edge Functions → binance-bot → Secrets).",
        },
        401,
      );
    }
    if (!botAuthed && !tvAuthed) {
      botDebug("index", "unauthorized_combined", {
        symbol: probeSymbol,
        tv_webhook: tvWant ? 1 : 0,
        tv_secret_configured: Boolean((Deno.env.get("TRADINGVIEW_WEBHOOK_SECRET") ?? "").trim()),
      });
      const detail = tvWant
        ? "TradingView webhook: set Edge secret TRADINGVIEW_WEBHOOK_SECRET and pass the same value as tv_secret (JSON body or ?tv_secret=). Or use header x-binance-bot-secret = BOT_SECRET."
        : "Missing or wrong x-binance-bot-secret (must match BOT_SECRET), or for TradingView add tradingview_webhook:true + tv_secret + symbol in body, or ?tv_webhook=1&tv_secret=...&symbol=BTCUSDT on the URL.";
      return jsonResponse({ ok: false, error: "Unauthorized", detail }, 401);
    }

    if (Boolean((parsedBody as any)?.telegram_ping)) {
      if (!botAuthed) {
        return jsonResponse(
          {
            ok: false,
            error: "Unauthorized",
            detail: "telegram_ping requires x-binance-bot-secret matching BOT_SECRET.",
          },
          401,
        );
      }
      await sendTelegramAlert(
        "Telegram ping OK — binance-bot received telegram_ping (check HTML/plain fallback if you see this as plain text).",
      );
      return jsonResponse({
        ok: true,
        mode: "telegram_ping",
        detail: "Sent one test message via Telegram API",
      });
    }

    if (healthCheckOnly) {
      if (!botAuthed) {
        return jsonResponse(
          {
            ok: false,
            error: "Unauthorized",
            detail: "health_check_only requires x-binance-bot-secret matching BOT_SECRET.",
          },
          401,
        );
      }
      return await handleHealthCheckOnly(sharedSupabase);
    }
    if (maintenanceOnly) {
      if (!botAuthed) {
        return jsonResponse(
          {
            ok: false,
            error: "Unauthorized",
            detail: "maintenance_only requires x-binance-bot-secret matching BOT_SECRET.",
          },
          401,
        );
      }
      const maintenance = await handleMaintenanceOnly(sharedSupabase);
      return jsonResponse({ ok: true, mode: "maintenance_only", ...maintenance });
    }
    if (debuggerHealthOnly) {
      if (!botAuthed) {
        return jsonResponse(
          {
            ok: false,
            error: "Unauthorized",
            detail: "debugger_health_only requires x-binance-bot-secret matching BOT_SECRET.",
          },
          401,
        );
      }
      return await handleDebuggerHealthOnly(
        sharedSupabase,
        debuggerApplyFixes,
        debuggerIncludeRetention,
      );
    }

    if (!symbols.length) {
      botDebug("index", "symbol_filter_missing", { body: parsedBody });
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: "Missing symbol or symbols in request body",
        ...(tvWant
          ? {
            hint:
              "For TradingView, add symbol or ticker in JSON or ?symbol= / ?ticker= on the URL.",
          }
          : {}),
      });
    }

    const wakeTrigger = toStringValue((parsedBody as any)?.trigger);
    const streamWake = wakeTrigger === "stream_wick";
    if (inFlightCycleStartedAt !== null && !streamWake) {
      const ageMs = Date.now() - inFlightCycleStartedAt;
      if (ageMs < EDGE_GLOBAL_TIMEOUT_MS) {
        botDebug("index", "cycle_overlap_skip", { age_ms: ageMs });
        return jsonResponse({
          ok: true,
          skipped: true,
          reason: "previous_cycle_in_flight",
          age_ms: ageMs,
        });
      }
      inFlightCycleStartedAt = null;
    }
    inFlightCycleStartedAt = Date.now();
    let edgeGlobalTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const cronWork = handleAuthenticatedCron(sharedSupabase, symbols, {
      liteCycle: tvAuthed,
      trigger: wakeTrigger ?? (tvAuthed ? "tradingview_webhook" : "cron"),
    }).finally(() => {
      inFlightCycleStartedAt = null;
      if (edgeGlobalTimeoutId !== undefined) {
        clearTimeout(edgeGlobalTimeoutId);
        edgeGlobalTimeoutId = undefined;
      }
    });
    const timeoutPromise = new Promise<Response>((resolve) => {
      edgeGlobalTimeoutId = setTimeout(() => {
        resolve(jsonResponse({
          ok: true,
          skipped: true,
          reason: "edge_global_timeout_guard",
          timeout_ms: EDGE_GLOBAL_TIMEOUT_MS,
        }));
      }, EDGE_GLOBAL_TIMEOUT_MS);
    });
    return await Promise.race([cronWork, timeoutPromise]);
  } catch (fatal) {
    const message = formatUnknownError(fatal);
    const transientDb = isTransientPostgrestError(fatal);
    if (transientDb) {
      console.warn("[FATAL transient]", message);
      botWarn("index", "fatal_boundary_transient", { message });
    } else {
      console.error("[FATAL]", message);
      botError("index", "fatal_boundary", { message, rawError: fatal });
    }
    const fatalLevel = transientDb ? "warn" : "error";
    await safeExecute(
      "catch_fatal_boundary_log",
      () =>
        sharedSupabase.from("logs").insert([{
          level: fatalLevel,
          source: "edge-fatal",
          message: "fatal_boundary",
          meta: {
            event: "fatal_boundary",
            detail: message,
            transient: transientDb,
          },
          created_at: new Date().toISOString(),
        }]),
      undefined,
    );
    await emitSentryFatalException(fatal, { stage: "deno_serve" });
    await persistEdgeFatalLog(
      supabaseForFatal,
      message,
      { stage: "deno_serve", transient: transientDb },
      fatalLevel,
    );
    return jsonResponse(
      {
        ok: false,
        error: message,
        recovered: true,
      },
      200,
    );
  }
});
