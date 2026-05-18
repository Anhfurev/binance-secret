// @ts-nocheck
/**
 * Staging endpoint: one SOLUSDT paper cycle on the live project (no local `supabase serve`).
 * Reuses binance-bot batch logic; does not claim the production edge_cycle lease.
 * Skips BTCUSDT market anchor pre-fetch (see sol-isolated-batch.ts).
 *
 * POST body (optional):
 *   { "test_mode": true, "paper_scenario": "momentum_buy", "paper_scenario_execute": false }
 *
 * Auth: x-binance-bot-secret = BOT_SECRET (same as binance-bot).
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { parsePaperScenarioRequest } from "../binance-bot/paper-scenario-runner.ts";
import { formatUnknownError, jsonResponse, safeReadJsonBody, toStringValue } from "../binance-bot/utils.ts";
import { finalizeEdgeJsonResponse } from "../binance-bot/edge-runtime.ts";
import { respondTestSolLoop } from "./edge-handler.ts";
import { runSolIsolatedSymbolBatch } from "./sol-isolated-batch.ts";

const TEST_SYMBOL = "SOLUSDT";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-binance-bot-secret",
};

function readDisabled(): boolean {
  const raw = String(Deno.env.get("TEST_SOL_LOOP_DISABLED") ?? "0").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function isBotAuthed(req: Request): boolean {
  const botSecret = (Deno.env.get("BOT_SECRET") ?? "").trim();
  const provided = (req.headers.get("x-binance-bot-secret") ?? "").trim();
  return Boolean(botSecret && provided && provided === botSecret);
}

async function assertSolPaperOnly(
  supabase: ReturnType<typeof createClient>,
): Promise<Response | null> {
  const { data, error } = await supabase
    .from("bot_settings")
    .select("id,symbol,is_live_trading_enabled")
    .eq("is_autopilot_enabled", true)
    .eq("symbol", TEST_SYMBOL)
    .eq("is_live_trading_enabled", true)
    .limit(1);
  if (error) {
    return jsonResponse({
      ok: false,
      test_mode: true,
      symbol: TEST_SYMBOL,
      error: "bot_settings_lookup_failed",
      detail: error.message,
    }, 503);
  }
  if (Array.isArray(data) && data.length > 0) {
    return jsonResponse({
      ok: false,
      test_mode: true,
      symbol: TEST_SYMBOL,
      error: "test_sol_loop_blocked_live_trading_enabled",
      detail: "Disable is_live_trading_enabled for SOLUSDT autopilot bots before using this endpoint.",
    }, 400);
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (readDisabled()) {
    return jsonResponse({
      ok: false,
      test_mode: true,
      symbol: TEST_SYMBOL,
      error: "test_sol_loop_disabled",
      detail: "Unset TEST_SOL_LOOP_DISABLED or set to 0 on this Edge function.",
    }, 503);
  }
  if (!isBotAuthed(req)) {
    return jsonResponse({
      ok: false,
      test_mode: true,
      error: "Unauthorized",
      detail: "Send x-binance-bot-secret matching BOT_SECRET.",
    }, 401);
  }

  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("ping") === "1") {
    return await finalizeEdgeJsonResponse(jsonResponse({
      ok: true,
      test_mode: true,
      symbol: TEST_SYMBOL,
      mode: "ping",
      hint: "POST with optional paper_scenario to run one isolated SOL paper cycle.",
    }));
  }
  if (req.method !== "POST") {
    return jsonResponse({
      ok: false,
      test_mode: true,
      error: "method_not_allowed",
      detail: "Use GET ?ping=1 or POST.",
    }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({
      ok: false,
      test_mode: true,
      error: "missing_supabase_env",
    }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const liveBlock = await assertSolPaperOnly(supabase);
  if (liveBlock) return liveBlock;

  const startedAtMs = Date.now();
  const lastAiPriceBySymbol = new Map<string, number>();
  let parsedBody = await safeReadJsonBody(req) as Record<string, unknown> | null;
  if ((parsedBody as { _invalidJson?: boolean })?._invalidJson) {
    parsedBody = { test_mode: true };
  }
  if (parsedBody?.test_mode === false) {
    return jsonResponse({
      ok: false,
      test_mode: true,
      error: "test_mode_required",
      detail: "This endpoint always runs in paper/staging mode; omit test_mode or set true.",
    }, 400);
  }

  const scenarioBody = {
    ...(parsedBody ?? {}),
    symbol: TEST_SYMBOL,
    test_mode: true,
  };
  const rawScenario = toStringValue(scenarioBody.paper_scenario);
  const parsedScenario = parsePaperScenarioRequest(scenarioBody);
  if (rawScenario && !parsedScenario.ok) {
    return jsonResponse({
      ok: false,
      test_mode: true,
      symbol: TEST_SYMBOL,
      error: "invalid_paper_scenario",
      detail: parsedScenario.error,
    }, 400);
  }
  const paperScenario = parsedScenario.ok
    ? { name: parsedScenario.value.scenario, execute: parsedScenario.value.execute }
    : null;

  const timing = { startedAtMs };
  try {
    const batch = await runSolIsolatedSymbolBatch({
      supabase,
      lastAiPriceBySymbol,
      paperScenario,
    });
    timing.batchDoneAtMs = Date.now();
    return await respondTestSolLoop({
      ok: true,
      test_mode: true,
      symbol: TEST_SYMBOL,
      mode: paperScenario ? "paper_scenario" : "symbol_batch",
      paper_scenario: paperScenario?.name ?? null,
      paper_scenario_execute: paperScenario?.execute ?? null,
      trigger: "test_sol_loop",
      scanned: batch.scanned,
      actions: batch.actions,
      cycle_id: batch.cycleId,
      batch_timeouts: batch.batchTimeouts,
      batch_errors: batch.batchErrors,
      batch_elapsed_ms: batch.allSettledElapsedMs,
    }, 200, timing);
  } catch (err) {
    return await respondTestSolLoop({
      ok: false,
      test_mode: true,
      symbol: TEST_SYMBOL,
      error: "test_sol_loop_failed",
      detail: formatUnknownError(err),
    }, 500, timing);
  }
});
