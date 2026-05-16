// @ts-nocheck
import { escapeHtml } from "./bot-shared.ts";
import { sendTelegramAlert } from "./notifier.ts";
import type { DebuggerIssue } from "./health-debugger.ts";

let lastDebuggerAlertAtMs = 0;
const lastExceptionTelegramAtByScope = new Map<string, number>();

export function readDebuggerAlertThrottleMs(): number {
  const raw = String(Deno.env.get("DEBUGGER_TELEGRAM_THROTTLE_MS") ?? "900000").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 15 * 60 * 1000;
  return Math.min(6 * 60 * 60 * 1000, Math.floor(n));
}

/** Per-scope cooldown for `sendDebuggerExceptionTelegram` (default 2 minutes). */
export function readDebuggerTelegramExceptionThrottleMs(): number {
  const raw = String(Deno.env.get("DEBUGGER_TELEGRAM_EXCEPTION_THROTTLE_MS") ?? "120000").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 120_000;
  return Math.min(60 * 60 * 1000, Math.floor(n));
}

/** When `1` or `true`, debugger digest Telegram includes up to five `info` issues. */
export function readDebuggerTelegramIncludeInfo(): boolean {
  const v = String(Deno.env.get("DEBUGGER_TELEGRAM_INCLUDE_INFO") ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Throttled DEBUGGER Telegram for runtime failures (symbol cycle, fatal boundary, etc.).
 * Uses the same Edge secrets as `sendTelegramAlert`.
 */
export async function sendDebuggerExceptionTelegram(params: {
  scope: string;
  detail: string;
  batchId?: string | null;
  /** When true, skips Telegram (still use DB logs elsewhere). */
  skip?: boolean;
}): Promise<void> {
  if (params.skip) return;
  if (String(Deno.env.get("DEBUGGER_TELEGRAM_EXCEPTION_DISABLE") ?? "").trim() === "1") return;
  const scope = String(params.scope ?? "").trim() || "unknown_scope";
  const detail = String(params.detail ?? "").trim() || "(no detail)";
  const now = Date.now();
  const throttleMs = readDebuggerTelegramExceptionThrottleMs();
  if (throttleMs > 0) {
    const prev = lastExceptionTelegramAtByScope.get(scope) ?? 0;
    if (now - prev < throttleMs) return;
    lastExceptionTelegramAtByScope.set(scope, now);
  }
  const batchLine = params.batchId
    ? `<b>batch</b>: <code>${escapeHtml(String(params.batchId))}</code>\n`
    : "";
  await sendTelegramAlert(
    `🛠️ <b>DEBUGGER</b> <b>exception</b>\n` +
      `<b>scope</b>: <code>${escapeHtml(scope)}</code>\n` +
      batchLine +
      `<pre>${escapeHtml(detail.slice(0, 3500))}</pre>`,
  );
}

export async function maybeNotifyDebuggerIssues(params: {
  issues: DebuggerIssue[];
  batchId: string;
  source: string;
}): Promise<boolean> {
  const { issues, batchId, source } = params;
  const criticalWarn = issues.filter((issue) =>
    issue.severity === "critical" || issue.severity === "warn"
  );
  const infoExtra = readDebuggerTelegramIncludeInfo()
    ? issues.filter((i) => i.severity === "info").slice(0, 5)
    : [];
  const actionable = [...criticalWarn, ...infoExtra];
  if (!actionable.length) return false;

  const now = Date.now();
  const throttleMs = readDebuggerAlertThrottleMs();
  if (throttleMs > 0 && now - lastDebuggerAlertAtMs < throttleMs) return false;
  lastDebuggerAlertAtMs = now;

  const critical = actionable.filter((i) => i.severity === "critical");
  const warns = actionable.filter((i) => i.severity === "warn");
  const infos = actionable.filter((i) => i.severity === "info");
  const lines = actionable.slice(0, 12).map((issue) => {
    const tag = issue.severity === "critical" ? "CRIT" : issue.severity === "warn" ? "WARN" : "INFO";
    return `• <b>${escapeHtml(tag)}</b> ${escapeHtml(issue.code)}: ${escapeHtml(issue.message)}`;
  });

  await sendTelegramAlert(
    `🛠️ <b>DEBUGGER</b> <i>${escapeHtml(source)}</i>\n` +
      `<b>batch</b>: <code>${escapeHtml(batchId)}</code>\n` +
      `<b>critical</b>: ${critical.length} · <b>warn</b>: ${warns.length}` +
      (infos.length ? ` · <b>info</b>: ${infos.length}` : "") +
      `\n${lines.join("\n")}`,
  );
  return true;
}
