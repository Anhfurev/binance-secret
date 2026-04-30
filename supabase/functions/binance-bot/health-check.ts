// @ts-nocheck
/**
 * Bot health check utilities — invoked at the end of each cron cycle and
 * also reachable directly via `health_check_only=true` request body.
 *
 * Design notes:
 * - Each helper is independent and idempotent so they can be called in any
 *   order without cross-state.
 * - All Telegram side effects are throttled in module-level state so a
 *   warm isolate doesn't spam during sustained incidents.
 * - DB writes always happen (so logs/health endpoints surface the issue),
 *   but Telegram is rate-limited.
 */
import type { createClient } from "npm:@supabase/supabase-js@2";
import { escapeHtml } from "./bot-shared.ts";
import { sendTelegramAlert } from "./notifier.ts";

const STALE_TRADE_WINDOW_MS = 24 * 60 * 60 * 1000;
const STALE_TRADE_TELEGRAM_THROTTLE_MS = 4 * 60 * 60 * 1000;
const LOGS_RETENTION_DAYS_DEFAULT = 7;
const AI_CACHE_RETENTION_HOURS_DEFAULT = 24;
const RETENTION_RUN_INTERVAL_MS = 4 * 60 * 60 * 1000;

let lastStaleTradeAlertAtMs = 0;
let lastRetentionRunAtMs = 0;

export type StaleTradeGuardResult = {
  staleCount: number;
  alerted: boolean;
  sampleIds: string[];
};

export type RetentionRunResult = {
  ran: boolean;
  logsDeleted: number | null;
  aiCacheDeleted: number | null;
  capitalReservationsDeleted: number | null;
  botDebugTracesDeleted: number | null;
  warRoomAuditsDeleted: number | null;
};

/**
 * Detect open trades older than 24h that have not had any DB update in the
 * same window. Trade row updates (trailing stop / highest_price_seen patches
 * in `bot.ts`) refresh `trades.updated_at` via the `trg_trades_set_updated_at`
 * trigger — so a stale `updated_at` indicates the cycle is no longer
 * maintaining the position.
 */
export async function runStaleTradeGuard(params: {
  supabase: ReturnType<typeof createClient>;
  batchId: string;
}): Promise<StaleTradeGuardResult> {
  const { supabase, batchId } = params;
  const cutoffIso = new Date(Date.now() - STALE_TRADE_WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from("trades")
    .select("id,user_id,symbol,opened_at,updated_at,entryPrice,extra")
    .ilike("status", "open")
    .lte("opened_at", cutoffIso)
    .lte("updated_at", cutoffIso)
    .order("updated_at", { ascending: true })
    .limit(300);
  if (error) {
    throw new Error(`stale_trade_guard_query_failed:${error.message}`);
  }
  const stale = Array.isArray(data) ? data : [];
  if (!stale.length) {
    return { staleCount: 0, alerted: false, sampleIds: [] };
  }

  const sampleIds = stale.slice(0, 50).map((row: any) => String(row.id));

  await supabase.from("logs").insert([{
    level: "warn",
    source: "health-check",
    message: "stale_trade_guard_alert",
    meta: {
      event: "stale_trade_guard_alert",
      batch_id: batchId,
      stale_count: stale.length,
      stale_trade_ids: sampleIds,
    },
    created_at: new Date().toISOString(),
  }]);

  const now = Date.now();
  if (now - lastStaleTradeAlertAtMs < STALE_TRADE_TELEGRAM_THROTTLE_MS) {
    return { staleCount: stale.length, alerted: false, sampleIds };
  }
  lastStaleTradeAlertAtMs = now;

  const sample = stale.slice(0, 8).map((row: any) => {
    const symbol = String(row?.symbol ?? "UNKNOWN");
    const opened = String(row?.opened_at ?? "n/a");
    const updated = String(row?.updated_at ?? "n/a");
    return `• ${escapeHtml(symbol)} opened=${escapeHtml(opened)} updated=${escapeHtml(updated)}`;
  }).join("\n");

  // Fire-and-forget so the cron loop response isn't blocked by Telegram.
  void sendTelegramAlert(
    `⚠️ <b>STALE TRADE GUARD</b>\n` +
      `<b>batch</b>: <code>${escapeHtml(batchId)}</code>\n` +
      `<b>stale_open_trades</b>: ${stale.length}\n` +
      `<b>criteria</b>: status=open, opened_at &gt; 24h, updated_at &gt; 24h\n` +
      `${sample ? `\n${sample}` : ""}`,
  );

  return { staleCount: stale.length, alerted: true, sampleIds };
}

/**
 * Periodic data hygiene — delete old `logs` and `ai_cache` rows so the
 * tables don't bloat to millions of rows. Throttled to once per 4h per warm
 * isolate so we don't repeat the same delete every cron tick.
 *
 * Also clears `capital_reservations` older than 5 minutes (BUY locks should
 * always be released by `executeBuyFlow` finally; this is a safety net).
 */
export async function runRetentionCleanup(params: {
  supabase: ReturnType<typeof createClient>;
  batchId: string;
  logsRetentionDays?: number;
  aiCacheRetentionHours?: number;
  /** Force a run regardless of throttle (used by `health_check_only` mode). */
  force?: boolean;
}): Promise<RetentionRunResult> {
  const {
    supabase,
    batchId,
    logsRetentionDays = LOGS_RETENTION_DAYS_DEFAULT,
    aiCacheRetentionHours = AI_CACHE_RETENTION_HOURS_DEFAULT,
    force = false,
  } = params;

  const now = Date.now();
  if (!force && now - lastRetentionRunAtMs < RETENTION_RUN_INTERVAL_MS) {
    return {
      ran: false,
      logsDeleted: null,
      aiCacheDeleted: null,
      capitalReservationsDeleted: null,
      botDebugTracesDeleted: null,
      warRoomAuditsDeleted: null,
    };
  }
  lastRetentionRunAtMs = now;

  const logsCutoffIso = new Date(now - logsRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  const aiCacheCutoffIso = new Date(now - aiCacheRetentionHours * 60 * 60 * 1000).toISOString();
  const capitalReservationsCutoffIso = new Date(now - 5 * 60 * 1000).toISOString();

  const [logsDel, aiCacheDel, capitalDel, tracesDel, warRoomDel] = await Promise.all([
    supabase
      .from("logs")
      .delete({ count: "exact" })
      .lt("created_at", logsCutoffIso),
    supabase
      .from("ai_cache")
      .delete({ count: "exact" })
      .lt("created_at", aiCacheCutoffIso),
    supabase
      .from("capital_reservations")
      .delete({ count: "exact" })
      .lt("created_at", capitalReservationsCutoffIso),
    supabase
      .from("bot_debug_traces")
      .delete({ count: "exact" })
      .lt("created_at", logsCutoffIso),
    supabase
      .from("war_room_audits")
      .delete({ count: "exact" })
      .lt("created_at", logsCutoffIso),
  ]);

  await supabase.from("logs").insert([{
    level: "info",
    source: "health-check",
    message: "retention_cleanup_executed",
    meta: {
      event: "retention_cleanup_executed",
      batch_id: batchId,
      logs_retention_days: logsRetentionDays,
      ai_cache_retention_hours: aiCacheRetentionHours,
      logs_deleted: logsDel.count ?? null,
      ai_cache_deleted: aiCacheDel.count ?? null,
      capital_reservations_deleted: capitalDel.count ?? null,
      bot_debug_traces_deleted: tracesDel.count ?? null,
      war_room_audits_deleted: warRoomDel.count ?? null,
      logs_error: logsDel.error?.message ?? null,
      ai_cache_error: aiCacheDel.error?.message ?? null,
      capital_reservations_error: capitalDel.error?.message ?? null,
      bot_debug_traces_error: tracesDel.error?.message ?? null,
      war_room_audits_error: warRoomDel.error?.message ?? null,
      forced: force,
    },
    created_at: new Date().toISOString(),
  }]);

  return {
    ran: true,
    logsDeleted: logsDel.error ? null : (logsDel.count ?? 0),
    aiCacheDeleted: aiCacheDel.error ? null : (aiCacheDel.count ?? 0),
    capitalReservationsDeleted: capitalDel.error ? null : (capitalDel.count ?? 0),
    botDebugTracesDeleted: tracesDel.error ? null : (tracesDel.count ?? 0),
    warRoomAuditsDeleted: warRoomDel.error ? null : (warRoomDel.count ?? 0),
  };
}

/**
 * Lightweight health probe — returns DB counters and ai_quota_state without
 * running the full bot cycle. Powers `health_check_only=true` in `index.ts`.
 */
export async function collectHealthSnapshot(params: {
  supabase: ReturnType<typeof createClient>;
}) {
  const { supabase } = params;
  const [openTrades, totalLogs, recentErrors, quotaState] = await Promise.all([
    supabase.from("trades").select("id", { count: "exact", head: true }).ilike("status", "open"),
    supabase.from("logs").select("id", { count: "exact", head: true }),
    supabase
      .from("logs")
      .select("id", { count: "exact", head: true })
      .eq("level", "error")
      .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString()),
    supabase
      .from("ai_quota_state")
      .select("id, consecutive_failures, cooldown_until, last_failure_at, updated_at")
      .eq("id", "global")
      .maybeSingle(),
  ]);

  return {
    open_trades: Number(openTrades.count ?? 0),
    total_logs: Number(totalLogs.count ?? 0),
    error_logs_last_hour: Number(recentErrors.count ?? 0),
    ai_quota_state: quotaState.data ?? null,
    ai_quota_state_error: quotaState.error?.message ?? null,
    timestamp: new Date().toISOString(),
  };
}
