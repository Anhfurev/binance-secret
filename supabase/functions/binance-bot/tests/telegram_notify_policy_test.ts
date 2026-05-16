// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import {
  readTelegramNotificationsEnabled,
  readTelegramNotifyErrorsAllowsSend,
  readTelegramSuppressHolds,
} from "../telegram-notify-policy.ts";

function restoreEnv(keys: string[], saved: Record<string, string | undefined>) {
  for (const k of keys) {
    const v = saved[k];
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
}

Deno.test("TG_NOTIFICATIONS_ENABLED=1 allows super trace without TELEGRAM_NOTIFY_ERRORS", () => {
  const keys = ["TG_NOTIFICATIONS_ENABLED", "TELEGRAM_NOTIFY_ERRORS"];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = Deno.env.get(k);
  try {
    Deno.env.set("TG_NOTIFICATIONS_ENABLED", "1");
    Deno.env.delete("TELEGRAM_NOTIFY_ERRORS");
    assertEquals(readTelegramNotificationsEnabled(), true);
    assertEquals(readTelegramNotifyErrorsAllowsSend(), true);
  } finally {
    restoreEnv(keys, saved);
  }
});

Deno.test("TELEGRAM_NOTIFY_ERRORS=false hard-mutes even with TG on", () => {
  const keys = ["TG_NOTIFICATIONS_ENABLED", "TELEGRAM_NOTIFY_ERRORS"];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = Deno.env.get(k);
  try {
    Deno.env.set("TG_NOTIFICATIONS_ENABLED", "1");
    Deno.env.set("TELEGRAM_NOTIFY_ERRORS", "false");
    assertEquals(readTelegramNotificationsEnabled(), false);
    assertEquals(readTelegramNotifyErrorsAllowsSend(), false);
  } finally {
    restoreEnv(keys, saved);
  }
});

Deno.test("TG_SUPPRESS_HOLDS=0 disables hold suppression default", () => {
  const prev = Deno.env.get("TG_SUPPRESS_HOLDS");
  try {
    Deno.env.set("TG_SUPPRESS_HOLDS", "0");
    assertEquals(readTelegramSuppressHolds(), false);
  } finally {
    if (prev === undefined) Deno.env.delete("TG_SUPPRESS_HOLDS");
    else Deno.env.set("TG_SUPPRESS_HOLDS", prev);
  }
});
