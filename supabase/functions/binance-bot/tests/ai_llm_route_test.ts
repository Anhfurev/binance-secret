// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import { readAiPrimaryLlmIsGroq, readAiSkipGemini } from "../ai-llm-route.ts";

Deno.test("readAiSkipGemini respects AI_SKIP_GEMINI / GEMINI_DISABLED", () => {
  const prev: Record<string, string | undefined> = {};
  for (const k of ["AI_SKIP_GEMINI", "GEMINI_DISABLED"] as const) {
    prev[k] = Deno.env.get(k) ?? undefined;
    Deno.env.delete(k);
  }
  try {
    assertEquals(readAiSkipGemini(), false);
    Deno.env.set("AI_SKIP_GEMINI", "1");
    assertEquals(readAiSkipGemini(), true);
    Deno.env.delete("AI_SKIP_GEMINI");
    Deno.env.set("GEMINI_DISABLED", "true");
    assertEquals(readAiSkipGemini(), true);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
});

Deno.test("readAiPrimaryLlmIsGroq is true only for AI_PRIMARY_LLM=groq", () => {
  const prev = Deno.env.get("AI_PRIMARY_LLM");
  try {
    Deno.env.delete("AI_PRIMARY_LLM");
    assertEquals(readAiPrimaryLlmIsGroq(), false);
    Deno.env.set("AI_PRIMARY_LLM", "gemini");
    assertEquals(readAiPrimaryLlmIsGroq(), false);
    Deno.env.set("AI_PRIMARY_LLM", "groq");
    assertEquals(readAiPrimaryLlmIsGroq(), true);
  } finally {
    if (prev === undefined) Deno.env.delete("AI_PRIMARY_LLM");
    else Deno.env.set("AI_PRIMARY_LLM", prev);
  }
});
