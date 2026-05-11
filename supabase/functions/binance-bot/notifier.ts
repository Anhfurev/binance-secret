// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVICE_ROLE_KEY, SUPABASE_URL } from "./constants.ts";
import { formatTelegramCycleFooter } from "./bot-shared.ts";

const TELEGRAM_MAX_RETRIES = 4;
const TELEGRAM_BASE_DELAY_MS = 800;

let telegramEnvWarned = false;

function resolveTelegramToken(): string {
  return (Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "").trim();
}

/** Primary `TELEGRAM_CHAT_ID`; some setups use `TELEGRAM_BOT_CHAT_ID` by mistake. */
function resolveTelegramChatId(): string {
  return (
    (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").trim() ||
    (Deno.env.get("TELEGRAM_BOT_CHAT_ID") ?? "").trim()
  );
}

function warnTelegramEnvOnce(token: string, chatId: string) {
  if (telegramEnvWarned) return;
  telegramEnvWarned = true;
  const parts: string[] = [];
  if (!token) parts.push("TELEGRAM_BOT_TOKEN");
  if (!chatId) parts.push("TELEGRAM_CHAT_ID (or TELEGRAM_BOT_CHAT_ID)");
  console.warn(
    `[binance-bot] Telegram alerts disabled (set Edge secrets): missing ${parts.join(" + ")}`,
  );
}

function stripHtmlForPlainTelegram(html: string): string {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function logTelegramFailureToDb(params: {
  status: number;
  detail: string;
}) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await supabase.from("logs").insert([{
      level: "warn",
      source: "telegram",
      message: "telegram_send_failed",
      meta: {
        event: "telegram_send_failed",
        http_status: params.status,
        detail: params.detail.slice(0, 900),
      },
      created_at: new Date().toISOString(),
    }]);
  } catch {
    // best-effort only
  }
}

export type SendTelegramAlertOpts = {
  /** When set (e.g. reconciler job), appended as cycle_id even if no cron context is active. */
  cycleId?: string | null;
};

async function postTelegramSendMessage(params: {
  token: string;
  chatId: string;
  text: string;
  parseMode: "HTML" | null;
}): Promise<Response> {
  const { token, chatId, text, parseMode } = params;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (parseMode) payload.parse_mode = parseMode;
  return await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function sendTelegramAlert(message: string, opts?: SendTelegramAlertOpts) {
  const token = resolveTelegramToken();
  const chatId = resolveTelegramChatId();
  if (!token || !chatId) {
    warnTelegramEnvOnce(token, chatId);
    return;
  }

  const text = `${message}${formatTelegramCycleFooter(opts?.cycleId ?? null)}`;

  for (let attempt = 0; attempt < TELEGRAM_MAX_RETRIES; attempt += 1) {
    try {
      let response = await postTelegramSendMessage({
        token,
        chatId,
        text,
        parseMode: "HTML",
      });
      if (response.ok) {
        return;
      }

      let body = await response.text();
      const looksLikeParseError =
        response.status === 400 &&
        /parse|entity|html|tag/i.test(body);
      if (looksLikeParseError) {
        const plain = stripHtmlForPlainTelegram(text);
        const retryPlain = await postTelegramSendMessage({
          token,
          chatId,
          text: plain.slice(0, 4000),
          parseMode: null,
        });
        if (retryPlain.ok) return;
        body = await retryPlain.text();
        response = retryPlain;
      }

      const isRetryableStatus = response.status === 429 ||
        response.status >= 500;
      if (!isRetryableStatus || attempt === TELEGRAM_MAX_RETRIES - 1) {
        console.error(
          `[binance-bot] telegram alert failed: ${response.status} ${body.slice(0, 400)}`,
        );
        void logTelegramFailureToDb({
          status: response.status,
          detail: body.slice(0, 500),
        });
        return;
      }
    } catch (error) {
      if (attempt === TELEGRAM_MAX_RETRIES - 1) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(
          `[binance-bot] telegram alert failed: ${msg}`,
        );
        void logTelegramFailureToDb({ status: 0, detail: msg.slice(0, 500) });
        return;
      }
    }

    await delayWithJitter(attempt);
  }

  // Exhausted retries.
  console.error(
    "[binance-bot] telegram alert failed: retries exhausted",
  );
}

export async function sendTrailingStopAlert(params: {
  symbol: string;
  pnlPercent: number;
}) {
  const { symbol, pnlPercent } = params;
  const sign = pnlPercent >= 0 ? "+" : "";
  await sendTelegramAlert(
    `🎯 <b>Trailing Stop Triggered!</b>\n` +
      `<b>Symbol:</b> ${symbol}\n` +
      `<b>Profit:</b> ${sign}${pnlPercent.toFixed(2)}%`,
  );
}

export async function getLatestTelegramCommandUpdate(commands: string[]) {
  const token = resolveTelegramToken();
  const chatId = resolveTelegramChatId();
  if (!token || !chatId) return null;

  const normalizedCommands = new Set(
    commands.map((command) => String(command ?? "").trim().toLowerCase()).filter(Boolean),
  );
  if (normalizedCommands.size === 0) return null;

  const url = `https://api.telegram.org/bot${token}/getUpdates?limit=10&timeout=0`;
  try {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) return null;
    const payload = await response.json() as {
      ok?: boolean;
      result?: Array<{
        update_id?: number;
        message?: { text?: string; chat?: { id?: number | string } };
      }>;
    };
    const updates = Array.isArray(payload.result) ? payload.result : [];
    for (let i = updates.length - 1; i >= 0; i -= 1) {
      const update = updates[i];
      const text = String(update?.message?.text ?? "").trim().toLowerCase();
      const updateChatId = String(update?.message?.chat?.id ?? "");
      if (normalizedCommands.has(text) && updateChatId === String(chatId)) {
        return {
          updateId: Number(update.update_id ?? 0),
          chatId: updateChatId,
          command: text,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function getLatestStatusCommandUpdate() {
  return await getLatestTelegramCommandUpdate(["/status"]);
}

export async function sendTradeRowNotification(params: {
  event: "insert" | "update";
  trade: {
    id?: string | null;
    user_id?: string | null;
    symbol?: string | null;
    type?: string | null;
    status?: string | null;
    entryPrice?: number | string | null;
    exitPrice?: number | string | null;
    pnl?: number | string | null;
    value?: number | string | null;
    notes?: string | null;
    exit_reason?: string | null;
  };
  reason?: string | null;
}) {
  const { event, trade, reason } = params;
  const symbol = String(trade.symbol ?? "UNKNOWN");
  const side = String(trade.type ?? "unknown").toUpperCase();
  const status = String(trade.status ?? "unknown");
  const resolvedReason = String(
    reason ??
      trade.exit_reason ??
      trade.notes ??
      "no_reason_provided",
  );
  const entryPrice = Number(trade.entryPrice ?? 0);
  const exitPrice = Number(trade.exitPrice ?? 0);
  const pnl = Number(trade.pnl ?? 0);
  const value = Number(trade.value ?? 0);
  const format = (n: number) => (Number.isFinite(n) ? n.toFixed(8) : "n/a");
  await sendTelegramAlert(
    `📣 <b>TRADE ROW ${event.toUpperCase()}</b>\n` +
      `<b>Symbol:</b> ${symbol}\n` +
      `<b>Action:</b> ${side}\n` +
      `<b>Status:</b> ${status}\n` +
      `<b>Value (USDT):</b> ${Number.isFinite(value) ? value.toFixed(2) : "n/a"}\n` +
      `<b>Entry:</b> ${format(entryPrice)}\n` +
      `<b>Exit:</b> ${format(exitPrice)}\n` +
      `<b>PnL:</b> ${Number.isFinite(pnl) ? pnl.toFixed(2) : "n/a"}\n` +
      `<b>Reason:</b> ${resolvedReason}`,
  );
}

/** Reconciliation / ghost flows: always include an explicit correlation id in the footer. */
export async function sendHighPriorityRedAlert(message: string, correlationId: string) {
  await sendTelegramAlert(
    `🚨 <b>RED ALERT — HIGH PRIORITY</b>\n` +
      `<b>Scope:</b> Exchange vs DB reconciliation\n` +
      `${message}`,
    { cycleId: correlationId },
  );
}

async function delayWithJitter(attempt: number) {
  const waitMs =
    2 ** attempt * TELEGRAM_BASE_DELAY_MS + Math.floor(Math.random() * 250);
  await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
}
