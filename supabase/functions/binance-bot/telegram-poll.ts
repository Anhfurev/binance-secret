// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";

const TELEGRAM_POLL_SOURCE = "telegram-poll";
const TELEGRAM_POLL_MESSAGE = "poll_offset";

function resolveTelegramToken(): string {
  return (Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "").trim();
}

function resolveTelegramChatId(): string {
  return (
    (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").trim() ||
    (Deno.env.get("TELEGRAM_BOT_CHAT_ID") ?? "").trim()
  );
}

async function readTelegramPollOffset(
  supabase: ReturnType<typeof createClient>,
): Promise<number> {
  const latest = await supabase
    .from("logs")
    .select("meta")
    .eq("source", TELEGRAM_POLL_SOURCE)
    .eq("message", TELEGRAM_POLL_MESSAGE)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const offset = Number((latest.data as { meta?: { offset?: number } } | null)?.meta?.offset ?? 0);
  return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

async function writeTelegramPollOffset(
  supabase: ReturnType<typeof createClient>,
  offset: number,
) {
  if (!Number.isFinite(offset) || offset < 0) return;
  await supabase.from("logs").insert([{
    level: "info",
    source: TELEGRAM_POLL_SOURCE,
    message: TELEGRAM_POLL_MESSAGE,
    meta: { event: "telegram_poll_offset", offset },
    created_at: new Date().toISOString(),
  }]);
}

export async function pollTelegramCommandUpdate(
  supabase: ReturnType<typeof createClient>,
  commands: string[],
) {
  const token = resolveTelegramToken();
  const chatId = resolveTelegramChatId();
  if (!token || !chatId) return null;

  const normalizedCommands = new Set(
    commands.map((command) => String(command ?? "").trim().toLowerCase()).filter(Boolean),
  );
  if (normalizedCommands.size === 0) return null;

  const offset = await readTelegramPollOffset(supabase);
  const url =
    `https://api.telegram.org/bot${token}/getUpdates?limit=30&timeout=0&offset=${offset}`;
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
    if (updates.length === 0) return null;

    let nextOffset = offset;
    let matched: {
      updateId: number;
      chatId: string;
      command: string;
    } | null = null;

    for (const update of updates) {
      const updateId = Number(update?.update_id ?? 0);
      if (Number.isFinite(updateId) && updateId >= 0) {
        nextOffset = Math.max(nextOffset, updateId + 1);
      }
      const text = String(update?.message?.text ?? "").trim().toLowerCase();
      const updateChatId = String(update?.message?.chat?.id ?? "");
      if (!matched && normalizedCommands.has(text) && updateChatId === String(chatId)) {
        matched = {
          updateId,
          chatId: updateChatId,
          command: text,
        };
      }
    }

    if (nextOffset > offset) {
      await writeTelegramPollOffset(supabase, nextOffset);
    }
    return matched;
  } catch {
    return null;
  }
}
