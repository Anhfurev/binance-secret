import { sendTelegramNotification } from "@/lib/trading/paper-scalp-telegram";
import {
  escapeTelegramHtml,
  tgBold,
  tgBullet,
} from "@/lib/trading/paper-scalp-telegram-html";

function clipStack(stack: string, max = 2800): string {
  if (stack.length <= max) return stack;
  return `${stack.slice(0, max)}\n…(truncated)`;
}

/** High-priority crash alert — fire-and-forget before re-throw. */
export function sendPaperEngineCrashAlert(error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const stack = escapeTelegramHtml(clipStack(err.stack ?? "n/a"));
  const message = [
    `🚨 ${tgBold("ENGINE CRASH DETECTED")}`,
    tgBullet(`Timestamp: ${escapeTelegramHtml(new Date().toISOString())}`),
    tgBullet(`Error Message: ${escapeTelegramHtml(err.message)}`),
    tgBullet("Stack Trace:"),
    `<pre>${stack}</pre>`,
  ].join("\n");
  sendTelegramNotification(message);
}
