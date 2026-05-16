import { assertEquals } from "jsr:@std/assert";
import {
  readPostStoplossReentryCooldownMs,
  readPortfolioStopClusterMax,
  readPortfolioStopClusterWindowMs,
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

Deno.test("paper stop churn defaults to three stops in six hours", () => {
  Deno.env.delete("PAPER_STOP_CHURN_WINDOW_MS");
  Deno.env.delete("PAPER_STOP_CHURN_MAX_STOPS");
  assertEquals(readStopChurnWindowMs(true), 6 * 60 * 60 * 1000);
  assertEquals(readStopChurnMaxStops(true), 3);
});

Deno.test("paper portfolio stop cluster defaults to three in two hours", () => {
  Deno.env.delete("PAPER_PORTFOLIO_STOP_WINDOW_MS");
  Deno.env.delete("PAPER_PORTFOLIO_STOP_MAX");
  assertEquals(readPortfolioStopClusterWindowMs(true), 2 * 60 * 60 * 1000);
  assertEquals(readPortfolioStopClusterMax(true), 3);
});
