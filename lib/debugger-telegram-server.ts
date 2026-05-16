/**
 * Server-only DEBUGGER → Telegram (Next.js). Uses the same env names as the Edge bot.
 * Never import from client components.
 */

const lastSentAtByScope = new Map<string, number>();

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function readThrottleMs(): number {
  const raw = String(process.env.DEBUGGER_NEXT_TELEGRAM_THROTTLE_MS ?? "120000").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 120_000;
  return Math.min(3_600_000, Math.floor(n));
}

function resolveToken(): string {
  return (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
}

function resolveChatId(): string {
  return (process.env.TELEGRAM_CHAT_ID ?? process.env.TELEGRAM_BOT_CHAT_ID ?? "").trim();
}

export type ReportNextDebuggerTelegramParams = {
  scope: string;
  detail: string;
  path?: string;
};

/**
 * Throttled Telegram alert for Next server/runtime failures.
 */
export async function reportNextDebuggerTelegram(params: ReportNextDebuggerTelegramParams): Promise<void> {
  if (String(process.env.DEBUGGER_NEXT_TELEGRAM_DISABLE ?? "").trim() === "1") return;
  const token = resolveToken();
  const chatId = resolveChatId();
  if (!token || !chatId) return;

  const scope = String(params.scope ?? "").trim() || "next_unknown";
  const now = Date.now();
  const throttleMs = readThrottleMs();
  if (throttleMs > 0) {
    const prev = lastSentAtByScope.get(scope) ?? 0;
    if (now - prev < throttleMs) return;
    lastSentAtByScope.set(scope, now);
  }

  const pathLine = params.path
    ? `<b>path</b>: <code>${escapeHtml(params.path)}</code>\n`
    : "";
  const text =
    `🛠️ <b>DEBUGGER</b> <b>Next</b>\n` +
    `<b>scope</b>: <code>${escapeHtml(scope)}</code>\n` +
    pathLine +
    `<pre>${escapeHtml(String(params.detail ?? "").slice(0, 3500))}</pre>`;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12_000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.warn("[debugger-telegram-server] send failed", res.status, await res.text().catch(() => ""));
    }
  } catch (e) {
    console.warn("[debugger-telegram-server] send error", e);
  } finally {
    clearTimeout(t);
  }
}
