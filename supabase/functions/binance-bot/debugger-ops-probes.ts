// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { getAiQuotaState } from "./ai-db.ts";
import {
  isBinanceRestGatewayEnabled,
  resolveBinanceRestBaseUrl,
  withBinanceGatewayFetchHeaders,
} from "./binance-rest-base.ts";
import { gatewayFetch } from "./gateway-http-client.ts";
import { getGroqKeysFromEnv, getGeminiKeySlotsFromEnv } from "./ai-keys.ts";
import {
  computeExpectedPaperDemoBalance,
  readPaperWalletReconcileToleranceUsd,
} from "./paper-wallet-reconcile.ts";
import type { DebuggerIssue } from "./health-debugger.ts";
import { runBuyPathProbes } from "./debugger-buy-probes.ts";
import { classifyTightTrailingExitIssue } from "./debugger-issue-rules.ts";
import {
  readGeminiRotationPerKey2hBudget,
  readGroqRotationPerKey2hBudget,
  readGroqRotationWarnThreshold,
  readGeminiRotationWarnThreshold,
} from "./debugger-error-triage.ts";
import { toNumber } from "./utils.ts";

export function readCronStaleMinutes(): number {
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

  const [cronPulse, autopilot, groqLimits, geminiLimits, profiles, trades, recentStops] = await Promise.all([
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
      .eq("meta->>event", "groq_key_rotated"),
    supabase
      .from("logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .eq("meta->>event", "gemini_key_rotated"),
    supabase.from("profiles").select("id,demo_balance,starting_balance").limit(100),
    supabase
      .from("trades")
      .select("status,pnl,value,extra,user_id,entryPrice,symbol,exit_reason,closed_at")
      .limit(5000),
    supabase
      .from("trades")
      .select("symbol,entryPrice,extra,exit_reason,closed_at")
      .eq("status", "stopped")
      .in("exit_reason", ["stoploss_hit", "trailing_stop_hit"])
      .gte("closed_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
      .order("closed_at", { ascending: false })
      .limit(40),
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
  const groqKeyCount = Math.max(1, getGroqKeysFromEnv().length);
  const perKeyBudget = readGroqRotationPerKey2hBudget();
  const groqWarnThreshold = Math.max(readGroqRotationWarnThreshold(), groqKeyCount * perKeyBudget);
  if (groqLimitHits >= groqWarnThreshold) {
    issues.push({
      code: "GROQ_LIMIT_ROTATION_HIGH",
      severity: "warn",
      message:
        `Groq key rotation is high (${groqLimitHits} logs / 2h vs threshold ${groqWarnThreshold}, ${groqKeyCount} keys) — ` +
        `DB cooldown cycling is active; BUY veto traffic drives most rotations`,
      detail: {
        hits_last_2h: groqLimitHits,
        warn_threshold: groqWarnThreshold,
        groq_key_count: groqKeyCount,
        per_key_budget: perKeyBudget,
        note:
          "Each BUY can call Groq veto; rate limits emit `groq_key_rotated` (throttled to 1 row / key / 5m). Failover is expected.",
        hint:
          "Tune DEBUGGER_GROQ_PER_KEY_2H_BUDGET (default 120), DEBUGGER_GROQ_ROTATION_WARN_THRESHOLD, widen AI_PRICE_MOVE_THRESHOLD_PCT, or add GROQ_API_KEYn.",
      },
    });
  } else if (groqLimitHits > 0) {
    summary.groq_rotation_note = "within_normal_rotation";
  }

  const geminiLimitHits = Number(geminiLimits.count ?? 0);
  summary.gemini_limit_hits_last_2h = geminiLimitHits;
  const geminiKeyCount = Math.max(1, getGeminiKeySlotsFromEnv().length);
  const geminiPerKeyBudget = readGeminiRotationPerKey2hBudget();
  const geminiWarnThreshold = Math.max(readGeminiRotationWarnThreshold(), geminiKeyCount * geminiPerKeyBudget);
  if (geminiLimitHits >= geminiWarnThreshold) {
    issues.push({
      code: "GEMINI_LIMIT_ROTATION_HIGH",
      severity: "warn",
      message:
        `Gemini key rotation is high (${geminiLimitHits} logs / 2h vs threshold ${geminiWarnThreshold}) — ` +
        `cycling + per-key DB cooldowns are active`,
      detail: {
        hits_last_2h: geminiLimitHits,
        warn_threshold: geminiWarnThreshold,
        gemini_key_count: geminiKeyCount,
        per_key_budget: geminiPerKeyBudget,
        hint:
          "Tune DEBUGGER_GEMINI_PER_KEY_2H_BUDGET (default 120), DEBUGGER_GEMINI_ROTATION_WARN_THRESHOLD, or add GEMINI_KEYS_POOL / GEMINI_API_KEYn / GEMINI_KEY_n.",
      },
    });
  } else if (geminiLimitHits > 0) {
    summary.gemini_rotation_note = "within_normal_rotation";
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

  const tightTrailIssue = classifyTightTrailingExitIssue(
    (Array.isArray(recentStops.data) ? recentStops.data : []).filter((row: {
      extra?: Record<string, unknown> | null;
    }) => row?.extra?.is_paper === true || row?.extra?.trade_mode === "paper"),
  );
  if (tightTrailIssue) issues.push(tightTrailIssue);

  const buyPath = await runBuyPathProbes(supabase);
  issues.push(...(buyPath.issues as DebuggerIssue[]));
  summary.buy_path = buyPath.summary;

  return { issues, summary };
}
