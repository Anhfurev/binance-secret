// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import { postTelegramSendMessage } from "../telegram-post-message.ts";

Deno.test("postTelegramSendMessage skips network when TELEGRAM_NOTIFY_ERRORS=false", async () => {
  const prev = Deno.env.get("TELEGRAM_NOTIFY_ERRORS");
  try {
    Deno.env.set("TELEGRAM_NOTIFY_ERRORS", "false");
    const res = await postTelegramSendMessage({
      token: "dummy",
      chatId: "1",
      text: "x",
      parseMode: null,
    });
    assertEquals(res.ok, true);
    const j = await res.json();
    assertEquals(j.ok, true);
  } finally {
    if (prev === undefined) Deno.env.delete("TELEGRAM_NOTIFY_ERRORS");
    else Deno.env.set("TELEGRAM_NOTIFY_ERRORS", prev);
  }
});
