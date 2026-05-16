import { assertEquals } from "jsr:@std/assert";
import {
  readDebuggerAlertThrottleMs,
  readDebuggerTelegramExceptionThrottleMs,
  readDebuggerTelegramIncludeInfo,
} from "../debugger-alerts.ts";
import { readDebuggerAutoIntervalMs } from "../debugger-auto-run.ts";
import { readCronStaleMinutes } from "../debugger-ops-probes.ts";

Deno.test("readDebuggerAlertThrottleMs defaults to fifteen minutes", () => {
  Deno.env.delete("DEBUGGER_TELEGRAM_THROTTLE_MS");
  assertEquals(readDebuggerAlertThrottleMs(), 900_000);
});

Deno.test("readDebuggerTelegramExceptionThrottleMs defaults to two minutes", () => {
  Deno.env.delete("DEBUGGER_TELEGRAM_EXCEPTION_THROTTLE_MS");
  assertEquals(readDebuggerTelegramExceptionThrottleMs(), 120_000);
});

Deno.test("readDebuggerTelegramIncludeInfo is false by default", () => {
  Deno.env.delete("DEBUGGER_TELEGRAM_INCLUDE_INFO");
  assertEquals(readDebuggerTelegramIncludeInfo(), false);
  Deno.env.set("DEBUGGER_TELEGRAM_INCLUDE_INFO", "1");
  assertEquals(readDebuggerTelegramIncludeInfo(), true);
  Deno.env.delete("DEBUGGER_TELEGRAM_INCLUDE_INFO");
});

Deno.test("readDebuggerAutoIntervalMs defaults to thirty minutes", () => {
  Deno.env.delete("DEBUGGER_AUTO_INTERVAL_MS");
  assertEquals(readDebuggerAutoIntervalMs(), 1_800_000);
});

Deno.test("readCronStaleMinutes defaults to eight minutes", () => {
  Deno.env.delete("DEBUGGER_CRON_STALE_MINUTES");
  assertEquals(readCronStaleMinutes(), 8);
});
