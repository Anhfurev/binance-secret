// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import {
  readDecisionTraceHoldThrottleMs,
  readDecisionTraceTelegramEnabled,
} from "../telegram-decision-trace.ts";

Deno.test("readDecisionTraceTelegramEnabled is opt-in", () => {
  const prev = Deno.env.get("DECISION_TRACE_TELEGRAM");
  try {
    Deno.env.delete("DECISION_TRACE_TELEGRAM");
    assertEquals(readDecisionTraceTelegramEnabled(), false);
    Deno.env.set("DECISION_TRACE_TELEGRAM", "1");
    assertEquals(readDecisionTraceTelegramEnabled(), true);
  } finally {
    if (prev === undefined) Deno.env.delete("DECISION_TRACE_TELEGRAM");
    else Deno.env.set("DECISION_TRACE_TELEGRAM", prev);
  }
});

Deno.test("readDecisionTraceHoldThrottleMs default one hour", () => {
  const prev = Deno.env.get("DECISION_TRACE_HOLD_THROTTLE_MS");
  try {
    Deno.env.delete("DECISION_TRACE_HOLD_THROTTLE_MS");
    assertEquals(readDecisionTraceHoldThrottleMs(), 3_600_000);
    Deno.env.set("DECISION_TRACE_HOLD_THROTTLE_MS", "0");
    assertEquals(readDecisionTraceHoldThrottleMs(), 0);
  } finally {
    if (prev === undefined) Deno.env.delete("DECISION_TRACE_HOLD_THROTTLE_MS");
    else Deno.env.set("DECISION_TRACE_HOLD_THROTTLE_MS", prev);
  }
});
