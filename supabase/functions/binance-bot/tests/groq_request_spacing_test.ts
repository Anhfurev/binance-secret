// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import {
  enforceGroqRequestSpacing,
  resetGroqRequestSpacingClockForTests,
} from "../groq-request-spacing.ts";

/** Run before the 2000ms-default test so `lastGroqRequestAt` is not primed by prior waits. */
Deno.test("enforceGroqRequestSpacing default gap is 2000ms when parallel cycles off", async () => {
  resetGroqRequestSpacingClockForTests();
  const prevGap = Deno.env.get("GROQ_MIN_REQUEST_GAP_MS");
  const prevPar = Deno.env.get("BOT_PARALLEL_SYMBOL_CYCLES");
  try {
    Deno.env.delete("GROQ_MIN_REQUEST_GAP_MS");
    Deno.env.set("BOT_PARALLEL_SYMBOL_CYCLES", "0");
    const t0 = Date.now();
    await enforceGroqRequestSpacing();
    await enforceGroqRequestSpacing();
    const elapsed = Date.now() - t0;
    assertEquals(elapsed >= 1900, true, `expected ~2000ms gap, got ${elapsed}ms`);
    assertEquals(elapsed < 2900, true, `parallel off should not use 3000ms default, got ${elapsed}ms`);
  } finally {
    if (prevGap === undefined) Deno.env.delete("GROQ_MIN_REQUEST_GAP_MS");
    else Deno.env.set("GROQ_MIN_REQUEST_GAP_MS", prevGap);
    if (prevPar === undefined) Deno.env.delete("BOT_PARALLEL_SYMBOL_CYCLES");
    else Deno.env.set("BOT_PARALLEL_SYMBOL_CYCLES", prevPar);
  }
});

Deno.test("enforceGroqRequestSpacing default gap is 3000ms when parallel cycles on", async () => {
  resetGroqRequestSpacingClockForTests();
  const prevGap = Deno.env.get("GROQ_MIN_REQUEST_GAP_MS");
  const prevPar = Deno.env.get("BOT_PARALLEL_SYMBOL_CYCLES");
  try {
    Deno.env.delete("GROQ_MIN_REQUEST_GAP_MS");
    Deno.env.set("BOT_PARALLEL_SYMBOL_CYCLES", "1");
    const t0 = Date.now();
    await enforceGroqRequestSpacing();
    await enforceGroqRequestSpacing();
    const elapsed = Date.now() - t0;
    assertEquals(elapsed >= 2800, true, `expected ~3000ms gap, got ${elapsed}ms`);
    assertEquals(elapsed < 4000, true, `expected one inter-call gap ~3000ms, got ${elapsed}ms`);
  } finally {
    if (prevGap === undefined) Deno.env.delete("GROQ_MIN_REQUEST_GAP_MS");
    else Deno.env.set("GROQ_MIN_REQUEST_GAP_MS", prevGap);
    if (prevPar === undefined) Deno.env.delete("BOT_PARALLEL_SYMBOL_CYCLES");
    else Deno.env.set("BOT_PARALLEL_SYMBOL_CYCLES", prevPar);
  }
});
