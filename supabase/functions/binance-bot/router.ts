// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { formatUnknownError, jsonResponse, safeReadJsonBody, toStringValue } from "./utils.ts";
import { botDebug, emitSentryBootProbe } from "./bot-debug.ts";
import { safeExecuteDetached } from "./safe-execute.ts";
import { handleAuthenticatedCron } from "./cron-runner.ts";
import { sendTelegramAlert } from "./notifier.ts";
import { parsePaperScenarioRequest, runPaperScenario } from "./paper-scenario-runner.ts";
import { parsePaperScenarioSuiteRequest, runPaperScenarioSuite } from "./paper-scenario-suite.ts";
import { collectHealthSnapshot, runRetentionCleanup, runStaleTradeGuard, type RetentionRunResult } from "./health-check.ts";
import {
  edgePingPayload,
  handleFunctionHealthRequest,
  readFunctionHealthFlags,
  wantsFunctionHealth,
} from "./function-health.ts";
import { runDebuggerHealthAndFix } from "./health-debugger.ts";
import { handleMaintenanceOnly } from "./index-maintenance.ts";
import { isTradingViewWebhookRequest, parseSymbolsFromBody, resolveTradingViewAuth } from "./middleware-factory.ts";
import { runPostBatchBalanceSync } from "./run-symbol-batch.ts";
import { runFunctionVitalityCheck } from "./function-health.ts";
import { readReconciliationEnabled, runReconciliationJob } from "./reconciler.ts";
import { releaseEdgeCycleLease, tryClaimEdgeCycleLease } from "./edge-cycle-lease.ts";
import { attachServerBackgroundLifeline } from "./server-lifecycle.ts";
import { handleHourlyMacroSync } from "./cron-hourly-sync.ts";

async function handleHealthCheckOnly(supabase: ReturnType<typeof createClient>): Promise<Response> {
  const startedAtMs = Date.now();
  const batchId = `health-${crypto.randomUUID().slice(0, 8)}`;
  const [snapshot, staleResult, retentionResult] = await Promise.all([
    collectHealthSnapshot({ supabase }),
    runStaleTradeGuard({ supabase, batchId }),
    runRetentionCleanup({ supabase, batchId, force: true }),
  ]);
  return jsonResponse({ ok: true, mode: "health_check_only", batch_id: batchId, elapsed_ms: Date.now() - startedAtMs, snapshot, stale_trade_guard: staleResult, retention_cleanup: retentionResult });
}

async function handleDebuggerHealthOnly(
  supabase: ReturnType<typeof createClient>,
  applyFixes: boolean,
  includeRetention: boolean,
): Promise<Response> {
  const startedAtMs = Date.now();
  const batchId = `debug-${crypto.randomUUID().slice(0, 8)}`;
  const snapshot = await collectHealthSnapshot({ supabase });
  const staleResult = await runStaleTradeGuard({ supabase, batchId });
  const debuggerResult = await runDebuggerHealthAndFix({ supabase, batchId, applyFixes });
  let retentionResult: RetentionRunResult | null = null;
  if (includeRetention) retentionResult = await runRetentionCleanup({ supabase, batchId, force: true });
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

export async function routeRequest(params: {
  req: Request;
  sharedSupabase: ReturnType<typeof createClient>;
  lastAiPriceBySymbol: Map<string, number>;
  EDGE_GLOBAL_TIMEOUT_MS: number;
}): Promise<Response> {
  const { req, sharedSupabase, lastAiPriceBySymbol, EDGE_GLOBAL_TIMEOUT_MS } = params;
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-binance-bot-secret" } });
  }
  const requestUrl = new URL(req.url);
  if (req.method === "GET" && requestUrl.searchParams.get("ping") === "1") {
    return jsonResponse(edgePingPayload());
  }
  let parsedBody = await safeReadJsonBody(req) as Record<string, unknown> | null;
  if ((parsedBody as any)?._invalidJson) {
    const qSym = toStringValue(requestUrl.searchParams.get("symbol")) ?? toStringValue(requestUrl.searchParams.get("ticker"));
    const tvQuery = requestUrl.searchParams.get("tv_webhook") === "1";
    if (!(tvQuery && qSym)) return jsonResponse({ ok: false, error: "Invalid JSON body", detail: "Request body is not valid JSON" }, 400);
    parsedBody = {};
  }
  const symbols = parseSymbolsFromBody(parsedBody, requestUrl.searchParams);
  const probeSymbol = symbols[0] ?? "unknown";
  const healthCheckOnly = Boolean((parsedBody as any)?.health_check_only);
  const hourlySyncOnly = Boolean((parsedBody as any)?.hourly_sync_only);
  const maintenanceOnly = Boolean((parsedBody as any)?.maintenance_only);
  const reconcileOnly = Boolean((parsedBody as any)?.reconcile_only);
  const debuggerHealthOnly = Boolean((parsedBody as any)?.debugger_health_only);
  const debuggerApplyFixes = (parsedBody as any)?.debugger_apply_fixes === true;
  const debuggerIncludeRetention = Boolean((parsedBody as any)?.debugger_include_retention);
  const functionHealthRequested = wantsFunctionHealth(parsedBody, requestUrl.searchParams);
  botDebug("index", "function_started", { method: req.method, sym: probeSymbol, n_symbols: symbols.length, health_check_only: healthCheckOnly, maintenance_only: maintenanceOnly, debugger_health_only: debuggerHealthOnly, debugger_apply_fixes: debuggerApplyFixes, debugger_include_retention: debuggerIncludeRetention, function_health: functionHealthRequested });
  safeExecuteDetached(
    "sentry_boot_probe",
    () => emitSentryBootProbe({ method: req.method, symbol: probeSymbol }),
    undefined,
  );
  const botSecret = (Deno.env.get("BOT_SECRET") ?? "").trim();
  const providedSecret = (req.headers.get("x-binance-bot-secret") ?? "").trim();
  const tvWant = isTradingViewWebhookRequest(parsedBody, requestUrl);
  const tvAuthed = Boolean(tvWant && resolveTradingViewAuth(parsedBody, requestUrl).ok);
  const botAuthed = Boolean(botSecret && providedSecret && providedSecret === botSecret);
  if (!botSecret) return jsonResponse({ ok: false, error: "Unauthorized", detail: "BOT_SECRET is not set on the binance-bot Edge function (Dashboard → Edge Functions → binance-bot → Secrets)." }, 401);
  if (!botAuthed && !tvAuthed) {
    const detail = tvWant
      ? "TradingView webhook: set Edge secret TRADINGVIEW_WEBHOOK_SECRET and pass the same value as tv_secret (JSON body or ?tv_secret=). Or use header x-binance-bot-secret = BOT_SECRET."
      : "Missing or wrong x-binance-bot-secret (must match BOT_SECRET), or for TradingView add tradingview_webhook:true + tv_secret + symbol in body, or ?tv_webhook=1&tv_secret=...&symbol=BTCUSDT on the URL.";
    return jsonResponse({ ok: false, error: "Unauthorized", detail }, 401);
  }
  if (Boolean((parsedBody as any)?.telegram_ping)) {
    if (!botAuthed) return jsonResponse({ ok: false, error: "Unauthorized", detail: "telegram_ping requires x-binance-bot-secret matching BOT_SECRET." }, 401);
    await sendTelegramAlert("Telegram ping OK — binance-bot received telegram_ping (check HTML/plain fallback if you see this as plain text).");
    return jsonResponse({ ok: true, mode: "telegram_ping", detail: "Sent one test message via Telegram API" });
  }
  if (functionHealthRequested) {
    if (!botAuthed) {
      return jsonResponse({
        ok: false,
        error: "Unauthorized",
        detail: "function_health requires x-binance-bot-secret matching BOT_SECRET.",
      }, 401);
    }
    const flags = readFunctionHealthFlags(parsedBody);
    const payload = await handleFunctionHealthRequest({
      supabase: sharedSupabase,
      applyFixes: flags.applyFixes,
      includeStale: flags.includeStale,
      runDebugger: flags.runDebugger,
    });
    return jsonResponse(payload, payload.ok ? 200 : 503);
  }
  if (healthCheckOnly) {
    if (!botAuthed) return jsonResponse({ ok: false, error: "Unauthorized", detail: "health_check_only requires x-binance-bot-secret matching BOT_SECRET." }, 401);
    return await handleHealthCheckOnly(sharedSupabase);
  }
  if (hourlySyncOnly) {
    if (!botAuthed) {
      return jsonResponse({
        ok: false,
        error: "Unauthorized",
        detail: "hourly_sync_only requires x-binance-bot-secret matching BOT_SECRET.",
      }, 401);
    }
    return await handleHourlyMacroSync(sharedSupabase);
  }
  if (maintenanceOnly) {
    if (!botAuthed) return jsonResponse({ ok: false, error: "Unauthorized", detail: "maintenance_only requires x-binance-bot-secret matching BOT_SECRET." }, 401);
    const maintenance = await handleMaintenanceOnly(sharedSupabase);
    return jsonResponse({ ok: true, mode: "maintenance_only", ...maintenance });
  }
  if (reconcileOnly) {
    if (!botAuthed) {
      return jsonResponse({
        ok: false,
        error: "Unauthorized",
        detail: "reconcile_only requires x-binance-bot-secret matching BOT_SECRET.",
      }, 401);
    }
    if (!readReconciliationEnabled()) {
      return jsonResponse({
        ok: false,
        error: "reconciliation_disabled",
        detail: "Set RECONCILER_ENABLED=1 on the binance-bot Edge function before reconcile_only.",
      }, 503);
    }
    const reconciliation = await runReconciliationJob({ supabase: sharedSupabase });
    return jsonResponse({ ok: true, mode: "reconcile_only", reconciliation });
  }
  if (debuggerHealthOnly) {
    if (!botAuthed) return jsonResponse({ ok: false, error: "Unauthorized", detail: "debugger_health_only requires x-binance-bot-secret matching BOT_SECRET." }, 401);
    return await handleDebuggerHealthOnly(sharedSupabase, debuggerApplyFixes, debuggerIncludeRetention);
  }
  const parsedSuite = parsePaperScenarioSuiteRequest(parsedBody as Record<string, unknown> | null);
  if (parsedSuite.ok && parsedSuite.value) {
    if (!botAuthed) return jsonResponse({ ok: false, error: "Unauthorized", detail: "paper_scenario_suite requires x-binance-bot-secret matching BOT_SECRET." }, 401);
    const suiteResult = await runPaperScenarioSuite({ supabase: sharedSupabase, request: parsedSuite.value, lastAiPriceBySymbol });
    return jsonResponse(suiteResult, suiteResult.ok ? 200 : 400);
  }
  if (!parsedSuite.ok) return jsonResponse({ ok: false, error: parsedSuite.error }, 400);
  const parsedScenario = parsePaperScenarioRequest(parsedBody as Record<string, unknown> | null);
  if (parsedScenario.ok) {
    if (!botAuthed) return jsonResponse({ ok: false, error: "Unauthorized", detail: "paper_scenario requires x-binance-bot-secret matching BOT_SECRET." }, 401);
    const scenarioResult = await runPaperScenario({ supabase: sharedSupabase, request: parsedScenario.value, lastAiPriceBySymbol });
    return jsonResponse(scenarioResult, scenarioResult.ok ? 200 : 400);
  }
  if (toStringValue((parsedBody as Record<string, unknown>)?.paper_scenario)) {
    return jsonResponse(
      { ok: false, error: "invalid_paper_scenario", detail: parsedScenario.error },
      400,
    );
  }
  if (!symbols.length) return jsonResponse({ ok: true, skipped: true, reason: "Missing symbol or symbols in request body", ...(tvWant ? { hint: "For TradingView, add symbol or ticker in JSON or ?symbol= / ?ticker= on the URL." } : {}) });
  attachServerBackgroundLifeline(symbols);
  const wakeTrigger = toStringValue((parsedBody as any)?.trigger);
  const streamWake = wakeTrigger === "stream_wick" || wakeTrigger === "stream_move";
  let edgeLeaseClaimed = false;
  if (!streamWake) {
    const leaseTtlSec = Math.max(
      120,
      Math.ceil(EDGE_GLOBAL_TIMEOUT_MS / 1000) + 30,
    );
    edgeLeaseClaimed = await tryClaimEdgeCycleLease(leaseTtlSec);
    if (!edgeLeaseClaimed) {
      return jsonResponse({ ok: true, skipped: true, reason: "edge_cycle_lease_held" });
    }
  }
  const cycleAbort = new AbortController();
  let edgeGlobalTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let leaseReleased = false;
  const releaseLeaseOnce = async () => {
    if (!edgeLeaseClaimed || leaseReleased) return;
    leaseReleased = true;
    await releaseEdgeCycleLease();
  };
  const cronWork = handleAuthenticatedCron(sharedSupabase, symbols, {
    liteCycle: tvAuthed,
    trigger: wakeTrigger ?? (tvAuthed ? "tradingview_webhook" : "cron"),
    signal: cycleAbort.signal,
  }, lastAiPriceBySymbol).finally(async () => {
    if (edgeGlobalTimeoutId !== undefined) clearTimeout(edgeGlobalTimeoutId);
    await releaseLeaseOnce();
  });
  const timeoutPromise = new Promise<Response>((resolve) => {
    edgeGlobalTimeoutId = setTimeout(() => {
      cycleAbort.abort("edge_global_timeout_guard");
      resolve(jsonResponse({
        ok: true,
        skipped: true,
        reason: "edge_global_timeout_guard",
        timeout_ms: EDGE_GLOBAL_TIMEOUT_MS,
      }));
    }, EDGE_GLOBAL_TIMEOUT_MS);
  });
  return await Promise.race([cronWork, timeoutPromise]);
}
