import { sendTelegramNotification } from "@/lib/trading/paper-scalp-telegram";

function clipStack(stack: string, max = 2800): string {
  if (stack.length <= max) return stack;
  return `${stack.slice(0, max)}\n…(truncated)`;
}

/** High-priority crash alert — fire-and-forget before re-throw. */
export function sendPaperEngineCrashAlert(error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const stack = clipStack(err.stack ?? "n/a");
  const message = [
    "🚨 *[ENGINE CRASH DETECTED]*",
    `• Timestamp: ${new Date().toISOString()}`,
    `• Error Message: ${err.message}`,
    `• Stack Trace:`,
    "```",
    stack,
    "```",
  ].join("\n");
  sendTelegramNotification(message);
}
