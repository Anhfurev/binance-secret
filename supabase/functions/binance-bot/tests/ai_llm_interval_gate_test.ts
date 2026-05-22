import { assertEquals } from "jsr:@std/assert";
import {
  buildAiIntervalGateLog,
  readAiLlmOutboundIntervalMs,
} from "../ai-llm-interval-gate.ts";

Deno.test("readAiLlmOutboundIntervalMs defaults to 15 minutes", () => {
  const prevInterval = Deno.env.get("AI_LLM_INTERVAL_MS");
  const prevCache = Deno.env.get("AI_CACHE_WINDOW_MS");
  const prevTest = Deno.env.get("IS_TEST_MODE");
  try {
    Deno.env.delete("AI_LLM_INTERVAL_MS");
    Deno.env.delete("AI_CACHE_WINDOW_MS");
    Deno.env.set("IS_TEST_MODE", "0");
    assertEquals(readAiLlmOutboundIntervalMs(), 900_000);
  } finally {
    if (prevInterval === undefined) Deno.env.delete("AI_LLM_INTERVAL_MS");
    else Deno.env.set("AI_LLM_INTERVAL_MS", prevInterval);
    if (prevCache === undefined) Deno.env.delete("AI_CACHE_WINDOW_MS");
    else Deno.env.set("AI_CACHE_WINDOW_MS", prevCache);
    if (prevTest === undefined) Deno.env.delete("IS_TEST_MODE");
    else Deno.env.set("IS_TEST_MODE", prevTest);
  }
});

Deno.test("buildAiIntervalGateLog includes wait seconds", () => {
  const line = buildAiIntervalGateLog("AVAXUSDT", {
    allowOutbound: false,
    ageMs: 120_000,
    waitMs: 780_000,
    intervalMs: 900_000,
  });
  assertEquals(line.includes("AVAXUSDT"), true);
  assertEquals(line.includes("wait_s=780"), true);
});
