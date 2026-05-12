import { assertEquals } from "jsr:@std/assert";
import {
  readPostStoplossReentryCooldownMs,
  readStopChurnMaxStops,
  readStopChurnWindowMs,
} from "../stop-reentry-cooldown.ts";

Deno.test("post stoploss cooldown defaults to thirty minutes", () => {
  Deno.env.delete("POST_STOPLOSS_REENTRY_COOLDOWN_MS");
  Deno.env.delete("SYMBOL_COOLDOWN_MINUTES");
  assertEquals(readPostStoplossReentryCooldownMs(), 1_800_000);
});

Deno.test("stop churn defaults to one stop in thirty minutes", () => {
  Deno.env.delete("STOP_CHURN_WINDOW_MS");
  Deno.env.delete("STOP_CHURN_MAX_STOPS");
  assertEquals(readStopChurnWindowMs(), 1_800_000);
  assertEquals(readStopChurnMaxStops(), 1);
});
