// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { getAiQuotaState } from "./ai-db.ts";
import {
  isBinanceRestGatewayEnabled,
  resolveBinanceRestBaseUrl,
  withBinanceGatewayFetchHeaders,
} from "./binance-rest-base.ts";
import { gatewayFetch } from "./gateway-http-client.ts";
import {
  computeExpectedPaperDemoBalance,
  readPaperWalletReconcileToleranceUsd,
} from "./paper-wallet-reconcile.ts";
import type { DebuggerIssue } from "./health-debugger.ts";
import { toNumber } from "./utils.ts";

function readCronStaleMinutes(): number {
  const raw = String(Deno.env.get("DEBUGGER_CRON_STALE_MINUTES") ?? "8").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 8;
  return Math.min(60, Math.floor(n));
}

export async function runOpsProbes(
  supabase: ReturnType<typeof createClient>,
): Promise<{ issues: DebuggerIssue[]; summary: Record<string, unknown> }> {
  const issues: DebuggerIssue[] = [];
  const summary: Record<string, unknown> = {};
  const staleMinutes = readCronStaleMinutes();
  const cronSinceIso = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();

  const [cronPulse, autopilot, groqLimits, profiles, trades] = await Promise.all([
    supabase
      .from("logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", cronSinceIso)
      .or("message.eq.cron_batch_start,message.eq.execution_hold,message.eq.execution_skip"),
    supabase
      .from("bot_settings")
      .select("id", { count: "exact", head: true })
      .eq("is_autopilot_enabled", true),
    supabase
      .from("logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .ilike("message", "%LIMIT HIT%"),
    supabase.from("profiles").select("id,demo_balance,starting_balance").limit(20),
    supabase
      .from("trades")
      .select("status,pnl,value,extra,user_id")
      .limit(5000),
  ]);

  const cronPulseCount = Number(cronPulse.count ?? 0);
  summary.cron_pulse_last_minutes = staleMinutes;
  summary.cron_pulse_count = cronPulseCount;
  if (cronPulseCount === 0) {
    issues.push({
      code: "CRON_PULSE_STALE",
      severity: "critical",
      message: `No cron / execution logs in the last ${staleMinutes} minutes`,
      detail: { since: cronSinceIso },
    });
  }

  const autopilotCount = Number(autopilot.count ?? 0);
  summary.autopilot_enabled_bots = autopilotCount;
  if (autopilotCount === 0) {
    issues.push({
      code: "NO_AUTOPILOT_BOTS",
      severity: "critical",
      message: "No bot_settings rows have autopilot enabled",
      detail: {},
    });
  }

  const groqLimitHits = Number(groqLimits.count ?? 0);
  summary.groq_limit_hits_last_2h = groqLimitHits;
  if (groqLimitHits >= 12) {
    issues.push({
      code: "GROQ_LIMIT_ROTATION_HIGH",
      severity: "warn",
      message: "Groq key rotation / limit hits are elevated",
      detail: { hits_last_2h: groqLimitHits },
    });
  }

  const quota = await getAiQuotaState("global");
  if (quota?.gemini_cooldown_until) {
    const untilMs = Date.parse(String(quota.gemini_cooldown_until));
    if (Number.isFinite(untilMs) && untilMs > Date.now()) {
      issues.push({
        code: "GEMINI_COOLDOWN_ACTIVE",
        severity: "warn",
        message: "Gemini quota cooldown is active — AI may fall back to cache",
        detail: {
          cooldown_until: quota.gemini_cooldown_until,
          consecutive_failures: quota.consecutive_gemini_failures,
        },
      });
    }
  }

  if (isBinanceRestGatewayEnabled()) {
    const base = resolveBinanceRestBaseUrl().replace(/\/+$/, "");
    try {
      const health = await gatewayFetch(`${base}/healthz`, {
        method: "GET",
        headers: withBinanceGatewayFetchHeaders(),
      });
      summary.gateway_healthz_status = health.status;
      if (!health.ok) {
        issues.push({
          code: "GATEWAY_HEALTHZ_FAIL",
          severity: "critical",
          message: "Binance REST gateway /healthz failed",
          detail: { status: health.status, base },
        });
      }
      const tick = await gatewayFetch(
        `${base}/stream/tick?symbol=BTCUSDT`,
        { method: "GET", headers: withBinanceGatewayFetchHeaders() },
      );
      summary.gateway_stream_tick_status = tick.status;
      if (tick.status === 403) {
        issues.push({
          code: "GATEWAY_STREAM_FORBIDDEN",
          severity: "warn",
          message: "Gateway /stream/tick returned 403 — check BINANCE_GATEWAY_SECRET on Edge + hub",
          detail: { base },
        });
      } else if (!tick.ok) {
        issues.push({
          code: "GATEWAY_STREAM_TICK_FAIL",
          severity: "warn",
          message: "Gateway stream tick endpoint is not healthy",
          detail: { status: tick.status, base },
        });
      }
    } catch (error) {
      issues.push({
        code: "GATEWAY_PROBE_ERROR",
        severity: "critical",
        message: "Failed to probe Binance REST gateway",
        detail: {
          base: resolveBinanceRestBaseUrl(),
          detail: error instanceof Error ? error.message : String(error),
        },
      });
    }
  } else {
    summary.gateway_enabled = false;
  }

  const tradeRows = Array.isArray(trades.data) ? trades.data : [];
  const profileRows = Array.isArray(profiles.data) ? profiles.data : [];
  const tolerance = readPaperWalletReconcileToleranceUsd();
  const drifts: Array<{ user_id: string; delta: number }> = [];
  for (const profile of profileRows) {
    const userId = String((profile as { id?: string }).id ?? "");
    if (!userId) continue;
    const starting = toNumber((profile as { starting_balance?: number }).starting_balance, 0);
    const actual = toNumber((profile as { demo_balance?: number }).demo_balance, 0);
    const userTrades = tradeRows.filter((row: { user_id?: string }) =>
      String(row?.user_id ?? "") === userId
    );
    const expected = computeExpectedPaperDemoBalance(starting, userTrades);
    const delta = Number((expected - actual).toFixed(2));
    if (Math.abs(delta) >= tolerance) {
      drifts.push({ user_id: userId, delta });
    }
  }
  summary.paper_wallet_drift_profiles = drifts.length;
  if (drifts.length > 0) {
    issues.push({
      code: "PAPER_WALLET_DRIFT",
      severity: "warn",
      message: "Paper demo_balance diverges from trades ledger",
      detail: { profiles: drifts.slice(0, 5), tolerance_usd: tolerance },
    });
  }

  return { issues, summary };
}
