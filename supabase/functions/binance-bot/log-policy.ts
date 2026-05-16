// @ts-nocheck
/** Central toggles so `public.logs` stays small unless you opt into verbose auditing. */

import { readTelegramVerboseLogging } from "./telegram-notify-policy.ts";

export function isVerboseDbLogs(): boolean {
  return readTelegramVerboseLogging();
}

/** decision-trace + cycle-summary rows (large meta, every symbol × cron). */
export function shouldPersistDecisionAuditLogs(): boolean {
  return (
    String(Deno.env.get("DECISION_TRACE_DB_LOGS") ?? "").trim() === "1" ||
    isVerboseDbLogs()
  );
}

/** `cron_batch_start` runtime row. */
export function shouldLogCronBatchStartRow(): boolean {
  return String(Deno.env.get("LOG_CRON_BATCH_START") ?? "0").trim() === "1";
}

/** `source=bot-cycle` rows from persistRunTelemetry (hold/skip spam). */
export function shouldPersistBotCycleTelemetryLog(
  action: "buy" | "sell" | "hold" | "skip",
): boolean {
  if (action === "buy" || action === "sell") return true;
  return (
    String(Deno.env.get("TELEMETRY_BOT_CYCLE_LOG_ON_HOLD") ?? "").trim() === "1" ||
    isVerboseDbLogs()
  );
}

/** `source=bot-skip` on buy/sell skip paths. */
export function shouldPersistBotSkipLog(): boolean {
  return String(Deno.env.get("BOT_SKIP_DB_LOGS") ?? "").trim() === "1" || isVerboseDbLogs();
}

/** `source=execution-outcome` (one row per bot per cron). Default on for minimal audit. */
export function shouldPersistExecutionOutcomeLog(): boolean {
  return String(Deno.env.get("EXECUTION_OUTCOME_DB_LOGS") ?? "1").trim() !== "0";
}

export function shouldPersistAiCacheHitLog(): boolean {
  return String(Deno.env.get("AI_CACHE_HIT_DB_LOGS") ?? "").trim() === "1" ||
    isVerboseDbLogs();
}

export function shouldPersistAiKeySuccessLog(): boolean {
  return String(Deno.env.get("AI_KEY_SUCCESS_DB_LOGS") ?? "").trim() === "1" ||
    isVerboseDbLogs();
}

/** Per-symbol HOLD Telegram (noisy with 3+ symbols/min). Cron digest replaces it unless enabled. */
export function shouldTelegramHoldHeartbeat(): boolean {
  const raw = String(Deno.env.get("TELEGRAM_HOLD_HEARTBEAT") ?? "").trim();
  if (raw === "1") return true;
  if (isVerboseDbLogs()) return true;
  const tg = String(Deno.env.get("TG_SUPPRESS_HOLDS") ?? "").trim().toLowerCase();
  return tg === "0" || tg === "false";
}

/** Trailing-stop DB sync → trade row Telegram (very noisy while price moves). */
export function shouldTelegramTrailingRowUpdate(): boolean {
  return String(Deno.env.get("TELEGRAM_TRAILING_ROW_UPDATE") ?? "0").trim() === "1" ||
    isVerboseDbLogs();
}
