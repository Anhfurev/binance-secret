// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { formatUnknownError } from "./utils.ts";
import { botDebug } from "./bot-debug.ts";
import { getTotalAccountBalanceUsdt } from "./binance.ts";
import { escapeHtml } from "./bot-shared.ts";
import { safeExecute } from "./safe-execute.ts";
import { sendTelegramAlert } from "./notifier.ts";

const FOUR_HOUR_MS = 4 * 60 * 60 * 1000;
const LATENCY_WARN_THROTTLE_MS = 5 * 60 * 1000;
const LATENCY_WARN_THRESHOLD_MS = 15_000;
let lastFourHourOpsHeartbeatAt = 0;
let lastLatencyAlertAtMs = 0;
let lastCycleSummary: {
  at: string;
  trigger: string;
  scanned: number;
  actions: number;
} | null = null;

export function recordCronCycleSummary(summary: {
  at: string;
  trigger: string;
  scanned: number;
  actions: number;
}) {
  lastCycleSummary = summary;
}

export async function resolveAnyLiveAutopilot(
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

export async function maybeSendFourHourOpsHeartbeat(
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
      `💓 <b>HEARTBEAT</b> <i>(4h ops ping — not trade frequency)</i>\n` +
        `${accountLine}\n` +
        `<b>Open trades</b>: ${openTrades}\n` +
        `<b>Reserved capital</b>: ${escapeHtml(reserved.toFixed(4))} USDT\n` +
        `<b>Scheduler</b>: pg_cron ~every 1 min (BTC/SOL/PEPE); optional <code>stream_wick</code> from Vultr hub when wake URL+secret are set\n` +
        (lastCycleSummary
          ? `<b>Last cycle</b>: ${escapeHtml(lastCycleSummary.trigger)} · scanned ${lastCycleSummary.scanned} · actions ${lastCycleSummary.actions} · ${escapeHtml(lastCycleSummary.at)}`
          : `<b>Last cycle</b>: n/a (this isolate has not finished a batch yet)`),
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

export function emitLatencyTelemetry(params: { batchId: string; totalExecutionMs: number }) {
  const { batchId, totalExecutionMs } = params;
  console.log(
    `[LATENCY] batch=${batchId} total_execution_ms=${totalExecutionMs} threshold_warn_ms=${LATENCY_WARN_THRESHOLD_MS}`,
  );
  if (totalExecutionMs <= LATENCY_WARN_THRESHOLD_MS) return;
  const now = Date.now();
  if (now - lastLatencyAlertAtMs < LATENCY_WARN_THROTTLE_MS) return;
  lastLatencyAlertAtMs = now;
  void sendTelegramAlert(
    `⚠️ <b>LATENCY WARNING</b>\n` +
      `<b>batch</b>: <code>${escapeHtml(batchId)}</code>\n` +
      `<b>duration_ms</b>: ${totalExecutionMs}\n` +
      `<b>threshold_ms</b>: ${LATENCY_WARN_THRESHOLD_MS}\n` +
      `Early warning before platform timeout threshold.`,
  );
}
