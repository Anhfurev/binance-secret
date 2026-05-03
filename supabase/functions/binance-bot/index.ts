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
  emitSentryBootProbe,
  emitSentryFatalException,
} from "./bot-debug.ts";
import { binanceTimeSyncCheck, getTotalAccountBalanceUsdt } from "./binance.ts";
import { resetAiCycleGuards } from "./index-ai.ts";
import { escapeHtml, withTelegramCycleScope } from "./bot-shared.ts";
import { safeExecute } from "./safe-execute.ts";
import {
  mergeBalanceSyncTargets,
  runPostBatchBalanceSync,
  runSymbolBatch,
} from "./run-symbol-batch.ts";
import {
  getLatestStatusCommandUpdate,
  sendTelegramAlert,
} from "./notifier.ts";
import {
  collectHealthSnapshot,
  runRetentionCleanup,
  runStaleTradeGuard,
} from "./health-check.ts";
import { runDebuggerHealthAndFix } from "./health-debugger.ts";

const lastAiPriceBySymbol = new Map<string, number>();

/** One Supabase client per warm isolate (service role; no per-request allocation). */
const sharedSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const FOUR_HOUR_MS = 4 * 60 * 60 * 1000;
const LATENCY_WARN_THROTTLE_MS = 5 * 60 * 1000;
const LATENCY_WARN_THRESHOLD_MS = 15_000;
let lastFourHourOpsHeartbeatAt = 0;
let lastLatencyAlertAtMs = 0;

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

async function maybeHandleTelegramStatusCommand(
  supabase: ReturnType<typeof createClient>,
) {
  const latestStatusUpdate = await getLatestStatusCommandUpdate();
  if (!latestStatusUpdate || !latestStatusUpdate.updateId) return;

  const marker = `status_handled_${latestStatusUpdate.updateId}`;
  const alreadyHandled = await supabase
    .from("logs")
    .select("id")
    .eq("source", "telegram-command")
    .eq("message", marker)
    .limit(1)
    .maybeSingle();
  if (alreadyHandled.data) return;

  const openTradesResult = await supabase
    .from("trades")
    .select("symbol, amount, value, entryPrice, opened_at")
    .ilike("status", "open")
    .order("opened_at", { ascending: false })
    .limit(20);

  const openTrades = Array.isArray(openTradesResult.data)
    ? openTradesResult.data
    : [];
  const header = `📊 <b>OPEN POSITIONS STATUS</b>\nTotal Open: ${openTrades.length}`;
  const body = openTrades.length === 0
    ? "\nNo open positions right now."
    : `\n${
      openTrades
        .map((trade: any) =>
          `• ${String(trade.symbol ?? "UNKNOWN")} | qty=${Number(trade.amount ?? 0).toFixed(4)} | value=${Number(trade.value ?? 0).toFixed(2)} USDT | entry=${Number(trade.entryPrice ?? 0).toFixed(8)}`
        )
        .join("\n")
    }`;
  await sendTelegramAlert(`${header}${body}`);

  await supabase.from("logs").insert([{
    level: "info",
    source: "telegram-command",
    message: marker,
    meta: {
      event: "status_command_handled",
      update_id: latestStatusUpdate.updateId,
      open_positions: openTrades.length,
    },
    created_at: new Date().toISOString(),
  }]);
}

function parseSymbolsFromBody(
  parsedBody: Record<string, unknown> | null,
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
  const single = toStringValue(parsedBody?.symbol);
  if (single) return [normalizeSymbol(single, DEFAULT_SYMBOL)];
  return [];
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
) {
  if (!supabase) return;
  try {
    await supabase.from("logs").insert([{
      level: "error",
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
): Promise<Response> {
  const startedAtMs = Date.now();
  const batchId = `debug-${crypto.randomUUID().slice(0, 8)}`;
  console.log("[DEBUGGER] starting debugger_health_only", { batchId, applyFixes });

  const [snapshot, staleResult, retentionResult, debuggerResult] = await Promise.all([
    safeExecute("debug_health_snapshot", () => collectHealthSnapshot({ supabase }), null),
    safeExecute("debug_stale_guard", () => runStaleTradeGuard({ supabase, batchId }), null),
    safeExecute(
      "debug_retention",
      () => runRetentionCleanup({ supabase, batchId, force: true }),
      null,
    ),
    safeExecute(
      "debugger_health",
      () => runDebuggerHealthAndFix({ supabase, batchId, applyFixes }),
      null,
    ),
  ]);

  return jsonResponse({
    ok: true,
    mode: "debugger_health_only",
    batch_id: batchId,
    elapsed_ms: Date.now() - startedAtMs,
    debugger: debuggerResult,
    snapshot,
    stale_trade_guard: staleResult,
    retention_cleanup: retentionResult,
  });
}

async function handleAuthenticatedCron(
  supabase: ReturnType<typeof createClient>,
  symbols: string[],
): Promise<Response> {
  const startedAtMs = Date.now();
  const batchId = crypto.randomUUID();

  console.log("[INIT]:", {
    batch: batchId.slice(0, 8),
    n_symbols: symbols.length,
    bn: Number(!!Deno.env.get("BINANCE_API_KEY")),
    se: Number(!!Deno.env.get("SENTRY_DSN")),
    gm: Number(!!Deno.env.get("GEMINI_API_KEY")),
    tg: Number(!!Deno.env.get("TELEGRAM_BOT_TOKEN")),
    bs: Number(!!Deno.env.get("BOT_SECRET")),
  });

  await safeExecute(
    "telegram_status_side_effects",
    () => maybeHandleTelegramStatusCommand(supabase),
    undefined,
  );

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
  const telegramChatId = (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").trim();
  if (!geminiKey.trim() || !telegramToken) {
    return jsonResponse(
      {
        ok: false,
        error: "Missing GEMINI_API_KEY or TELEGRAM_BOT_TOKEN",
        recovered: true,
        batch_id: batchId,
      },
      200,
    );
  }
  if (!telegramChatId) {
    console.warn(
      "[binance-bot] TELEGRAM_CHAT_ID is empty — sendTelegramAlert will no-op until you set it (Supabase Dashboard → Edge Functions → binance-bot → Secrets)",
    );
  }

  await safeExecute("runtime_log_batch_start", async () => {
    await supabase.from("logs").insert(
      symbols.map((sym) => ({
        level: "info",
        source: "runtime",
        symbol: sym,
        message: "function_started",
        meta: {
          event: "function_started",
          symbol: sym,
          batch_id: batchId,
          symbol_count: symbols.length,
        },
        created_at: new Date().toISOString(),
      })),
    );
  }, undefined);

  await safeExecute("binance_time_sync", () => binanceTimeSyncCheck(), undefined);
  botDebug("index", "time_sync_ok", { n_symbols: symbols.length, batchId });

  resetAiCycleGuards();

  const allActions: BotActionResult[] = [];
  const mergedTargets = new Map<string, { isLiveMode: boolean; symbols: Set<string> }>();
  let cycleEmergencyAbort = false;
  let totalMs = 0;
  let totalScanned = 0;
  const perSymbol: Array<{ symbol: string; ok: boolean; detail?: string; scanned?: number }> =
    [];

  const symbolResults = await Promise.all(symbols.map(async (symbolFilter) => {
    try {
      console.log(`[${batchId}] ⏳ Processing ${symbolFilter} (Parallel Mode)`);
      const batchResult = await withTelegramCycleScope(null, () =>
        runSymbolBatch({ supabase, symbolFilter, lastAiPriceBySymbol }));
      console.log(
        `[MEMORY] ${symbolFilter} done. Heap: ${Math.round(Deno.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      );
      return { symbol: symbolFilter, ok: true as const, batchResult };
    } catch (reason) {
      const detail = formatUnknownError(reason);
      const msg = reason instanceof Error ? reason.message : detail;
      console.error(`❌ Error in ${symbolFilter} cycle:`, msg);
      await safeExecute(
        "catch_symbol_cycle_failed_log",
        () =>
          supabase.from("logs").insert([{
            level: "error",
            source: "symbol-cycle",
            symbol: symbolFilter,
            message: "symbol_cycle_failed",
            meta: {
              event: "symbol_cycle_failed",
              detail,
              batch_id: batchId,
            },
            created_at: new Date().toISOString(),
          }]),
        undefined,
      );
      return { symbol: symbolFilter, ok: false as const, detail };
    }
  }));
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
    });
  }

  await runPostBatchBalanceSync({
    supabase,
    balanceSyncTargets: mergedTargets,
    fallbackSymbol: symbols[0] ?? DEFAULT_SYMBOL,
  });

  const staleResCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const staleResDel = await supabase
    .from("capital_reservations")
    .delete()
    .lt("created_at", staleResCutoff);
  if (staleResDel.error) {
    botDebug("index", "capital_reservations_stale_cleanup_error", {
      batchId,
      detail: staleResDel.error.message,
    });
  }

  const hasLiveTrading = [...mergedTargets.values()].some((t) => t.isLiveMode);
  await maybeSendFourHourOpsHeartbeat(supabase, { hasLiveTrading });
  await safeExecute(
    "stale_trade_guard",
    () => runStaleTradeGuard({ supabase, batchId }),
    undefined,
  );
  await safeExecute(
    "retention_cleanup",
    () => runRetentionCleanup({ supabase, batchId }),
    undefined,
  );

  console.log("[MEMORY]", Deno.memoryUsage());
  const totalExecutionMs = Date.now() - startedAtMs;
  emitLatencyTelemetry({ batchId, totalExecutionMs });

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
  });
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
    const parsedBody = await safeReadJsonBody(req) as Record<string, unknown> | null;
    if ((parsedBody as any)?._invalidJson) {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid JSON body",
          detail: "Request body is not valid JSON",
        },
        400,
      );
    }
    const symbols = parseSymbolsFromBody(parsedBody);
    const probeSymbol = symbols[0] ?? "unknown";
    const healthCheckOnly = Boolean((parsedBody as any)?.health_check_only);
    const debuggerHealthOnly = Boolean((parsedBody as any)?.debugger_health_only);
    const debuggerApplyFixes = (parsedBody as any)?.debugger_apply_fixes !== false;

    botDebug("index", "function_started", {
      method: req.method,
      sym: probeSymbol,
      n_symbols: symbols.length,
      health_check_only: healthCheckOnly,
      debugger_health_only: debuggerHealthOnly,
      debugger_apply_fixes: debuggerApplyFixes,
    });
    void emitSentryBootProbe({ method: req.method, symbol: probeSymbol });

    const botSecret = Deno.env.get("BOT_SECRET") ?? "";
    const providedSecret = req.headers.get("x-binance-bot-secret") ?? "";
    if (!botSecret.trim() || providedSecret !== botSecret) {
      botDebug("index", "unauthorized_request", { symbol: probeSymbol });
      return jsonResponse(
        {
          ok: false,
          error: "Unauthorized",
          detail: "Missing or invalid x-binance-bot-secret header",
        },
        401,
      );
    }

    if (healthCheckOnly) {
      return await handleHealthCheckOnly(sharedSupabase);
    }
    if (debuggerHealthOnly) {
      return await handleDebuggerHealthOnly(sharedSupabase, debuggerApplyFixes);
    }

    if (!symbols.length) {
      botDebug("index", "symbol_filter_missing", { body: parsedBody });
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: "Missing symbol or symbols in request body",
      });
    }

    return await handleAuthenticatedCron(sharedSupabase, symbols);
  } catch (fatal) {
    const message = formatUnknownError(fatal);
    console.error("[FATAL]", message);
    botError("index", "fatal_boundary", { message, rawError: fatal });
    await safeExecute(
      "catch_fatal_boundary_log",
      () =>
        sharedSupabase.from("logs").insert([{
          level: "error",
          source: "edge-fatal",
          message: "fatal_boundary",
          meta: {
            event: "fatal_boundary",
            detail: message,
          },
          created_at: new Date().toISOString(),
        }]),
      undefined,
    );
    await emitSentryFatalException(fatal, { stage: "deno_serve" });
    await persistEdgeFatalLog(supabaseForFatal, message, { stage: "deno_serve" });
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
