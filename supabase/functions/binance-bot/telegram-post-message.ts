// @ts-nocheck
/** Isolated Telegram `sendMessage` POST so `notifier.ts` stays under the line budget. */
import { describeThrownValue } from "./utils.ts";
import { readTelegramNotificationsEnabled } from "./telegram-notify-policy.ts";

const MUTED_TELEGRAM_JSON = JSON.stringify({
  ok: true,
  result: { message_id: 0, chat: { id: 0 }, text: "" },
  description: "TELEGRAM_NOTIFY_ERRORS=false",
});

export async function postTelegramSendMessage(params: {
  token: string;
  chatId: string;
  text: string;
  parseMode: "HTML" | null;
}): Promise<Response> {
  if (!readTelegramNotificationsEnabled()) {
    console.log("[TELEGRAM MUTED] Suppressed message.");
    return new Response(MUTED_TELEGRAM_JSON, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { token, chatId, text, parseMode } = params;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (parseMode) payload.parse_mode = parseMode;
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(`telegram_fetch_failed:${describeThrownValue(err)}`);
  }
}
