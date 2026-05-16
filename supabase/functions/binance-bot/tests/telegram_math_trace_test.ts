// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import { readCronMathTraceTelegramEnabled, sendCronMathTraceTelegram } from "../telegram-math-trace.ts";

Deno.test("readCronMathTraceTelegramEnabled is opt-in", () => {
  const prev = Deno.env.get("CRON_MATH_TRACE_TELEGRAM");
  try {
    Deno.env.delete("CRON_MATH_TRACE_TELEGRAM");
    assertEquals(readCronMathTraceTelegramEnabled(), false);
    Deno.env.set("CRON_MATH_TRACE_TELEGRAM", "1");
    assertEquals(readCronMathTraceTelegramEnabled(), true);
  } finally {
    if (prev === undefined) Deno.env.delete("CRON_MATH_TRACE_TELEGRAM");
    else Deno.env.set("CRON_MATH_TRACE_TELEGRAM", prev);
  }
});

Deno.test("sendCronMathTraceTelegram no-ops on null snapshot without throwing", async () => {
  await sendCronMathTraceTelegram({
    symbol: "PEPEUSDT",
    snapshot: null as unknown as import("../types.ts").IndicatorSnapshot,
  });
});

Deno.test("sendCronMathTraceTelegram no-ops on empty symbol", async () => {
  await sendCronMathTraceTelegram({
    symbol: "   ",
    snapshot: {} as import("../types.ts").IndicatorSnapshot,
  });
});
