// @ts-nocheck
import { formatTelegramCycleFooter } from "./bot-shared.ts";

const TELEGRAM_MAX_RETRIES = 4;
const TELEGRAM_BASE_DELAY_MS = 800;

let telegramEnvWarned = false;

function warnTelegramEnvOnce(token: string, chatId: string) {
  if (telegramEnvWarned) return;
  telegramEnvWarned = true;
  const parts: string[] = [];
  if (!token) parts.push("TELEGRAM_BOT_TOKEN");
  if (!chatId) parts.push("TELEGRAM_CHAT_ID");
  console.warn(
    `[binance-bot] Telegram alerts disabled (set Edge secrets): missing ${parts.join(" + ")}`,
  );
}

export type SendTelegramAlertOpts = {
  /** When set (e.g. reconciler job), appended as cycle_id even if no cron context is active. */
  cycleId?: string | null;
};

export async function sendTelegramAlert(message: string, opts?: SendTelegramAlertOpts) {
  const token = (Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "").trim();
  const chatId = (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").trim();
  if (!token || !chatId) {
    warnTelegramEnvOnce(token, chatId);
    return;
  }

  const text = `${message}${formatTelegramCycleFooter(opts?.cycleId ?? null)}`;

  // Keep the raw token in path (Telegram format: bot<token>/sendMessage).
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  for (let attempt = 0; attempt < TELEGRAM_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      if (response.ok) {
        return;
      }

      const body = await response.text();
      const isRetryableStatus = response.status === 429 ||
        response.status >= 500;
      if (!isRetryableStatus || attempt === TELEGRAM_MAX_RETRIES - 1) {
        console.error(
          `[binance-bot] telegram alert failed: ${response.status} ${body.slice(0, 400)}`,
        );
        return;
      }
    } catch (error) {
      if (attempt === TELEGRAM_MAX_RETRIES - 1) {
        console.error(
          `[binance-bot] telegram alert failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
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

export async function getLatestStatusCommandUpdate() {
  const token = (Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "").trim();
  const chatId = (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").trim();
  if (!token || !chatId) return null;

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
      if (text === "/status" && updateChatId === String(chatId)) {
        return {
          updateId: Number(update.update_id ?? 0),
          chatId: updateChatId,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
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
