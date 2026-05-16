// @ts-nocheck
/**
 * Central Telegram notification policy.
 * `TG_*` aliases map to existing flags so ops can use one naming scheme on Edge.
 */

function truthy(raw: string | undefined): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function falsy(raw: string | undefined): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

/** Master switch: `TG_NOTIFICATIONS_ENABLED=1` (default on unless `0`). Also honors `TELEGRAM_NOTIFY_ERRORS=false` as hard off. */
export function readTelegramNotificationsEnabled(): boolean {
  const tg = Deno.env.get("TG_NOTIFICATIONS_ENABLED");
  if (falsy(tg)) return false;
  const legacy = String(Deno.env.get("TELEGRAM_NOTIFY_ERRORS") ?? "").trim();
  if (legacy.toLowerCase() === "false") return false;
  return true;
}

/** When false (`TG_SUPPRESS_HOLDS=0`), decision traces and hold heartbeats are not throttled away. */
export function readTelegramSuppressHolds(): boolean {
  const raw = Deno.env.get("TG_SUPPRESS_HOLDS");
  if (raw != null && String(raw).trim() !== "") {
    return !falsy(raw);
  }
  return true;
}

/** Verbose Telegram + related DB telemetry (`TG_VERBOSE_LOGGING=1` or `VERBOSE_DB_LOGS=1`). */
export function readTelegramVerboseLogging(): boolean {
  if (truthy(Deno.env.get("TG_VERBOSE_LOGGING"))) return true;
  return String(Deno.env.get("VERBOSE_DB_LOGS") ?? "").trim() === "1";
}

/**
 * Super-detailed cron trace gate.
 * `TG_NOTIFICATIONS_ENABLED=1` → allow unless `TELEGRAM_NOTIFY_ERRORS=false`.
 * Legacy: non-empty `TELEGRAM_NOTIFY_ERRORS` (not `false`) also allows.
 */
export function readTelegramNotifyErrorsAllowsSend(): boolean {
  if (!readTelegramNotificationsEnabled()) return false;
  const notifyErrors = String(Deno.env.get("TELEGRAM_NOTIFY_ERRORS") ?? "").trim();
  if (notifyErrors.toLowerCase() === "false") return false;
  if (truthy(Deno.env.get("TG_NOTIFICATIONS_ENABLED"))) return true;
  return notifyErrors.length > 0;
}
