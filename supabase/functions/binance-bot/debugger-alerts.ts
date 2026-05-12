// @ts-nocheck
import { escapeHtml } from "./bot-shared.ts";
import { sendTelegramAlert } from "./notifier.ts";
import type { DebuggerIssue } from "./health-debugger.ts";

let lastDebuggerAlertAtMs = 0;

function readDebuggerAlertThrottleMs(): number {
  const raw = String(Deno.env.get("DEBUGGER_TELEGRAM_THROTTLE_MS") ?? "900000").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 15 * 60 * 1000;
  return Math.min(6 * 60 * 60 * 1000, Math.floor(n));
}

export async function maybeNotifyDebuggerIssues(params: {
  issues: DebuggerIssue[];
  batchId: string;
  source: string;
}): Promise<boolean> {
  const { issues, batchId, source } = params;
  const actionable = issues.filter((issue) =>
    issue.severity === "critical" || issue.severity === "warn"
  );
  if (!actionable.length) return false;

  const now = Date.now();
  const throttleMs = readDebuggerAlertThrottleMs();
  if (throttleMs > 0 && now - lastDebuggerAlertAtMs < throttleMs) return false;
  lastDebuggerAlertAtMs = now;

  const critical = actionable.filter((i) => i.severity === "critical");
  const warns = actionable.filter((i) => i.severity === "warn");
  const lines = actionable.slice(0, 10).map((issue) => {
    const tag = issue.severity === "critical" ? "CRIT" : "WARN";
    return `• <b>${escapeHtml(tag)}</b> ${escapeHtml(issue.code)}: ${escapeHtml(issue.message)}`;
  });

  await sendTelegramAlert(
    `🛠️ <b>DEBUGGER</b> <i>${escapeHtml(source)}</i>\n` +
      `<b>batch</b>: <code>${escapeHtml(batchId)}</code>\n` +
      `<b>critical</b>: ${critical.length} · <b>warn</b>: ${warns.length}\n` +
      `${lines.join("\n")}`,
  );
  return true;
}
