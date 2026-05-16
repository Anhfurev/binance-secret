import { assertEquals } from "jsr:@std/assert";
import {
  readAiProviderMatrixEnabled,
  readSymbolMatrixGapMs,
  resolveMatrixFallbackProvider,
  resolveMatrixPrimaryProvider,
} from "../ai-provider-matrix.ts";

Deno.test("resolveMatrixPrimaryProvider alternates groq/gemini by index", () => {
  assertEquals(resolveMatrixPrimaryProvider(0), "groq");
  assertEquals(resolveMatrixPrimaryProvider(1), "gemini");
  assertEquals(resolveMatrixPrimaryProvider(2), "groq");
  assertEquals(resolveMatrixFallbackProvider(0), "gemini");
  assertEquals(resolveMatrixFallbackProvider(1), "groq");
});

Deno.test("readSymbolMatrixGapMs defaults 400ms min 200 with preemptive matrix", () => {
  const prevGap = Deno.env.get("SYMBOL_MATRIX_GAP_MS");
  const prevMatrix = Deno.env.get("AI_PROVIDER_MATRIX");
  const prevPreempt = Deno.env.get("LLM_PREEMPTIVE_KEY_ROUTING");
  try {
    Deno.env.delete("SYMBOL_MATRIX_GAP_MS");
    Deno.env.delete("GEMINI_CRON_SYMBOL_GAP_MS");
    Deno.env.set("AI_PROVIDER_MATRIX", "1");
    Deno.env.set("LLM_PREEMPTIVE_KEY_ROUTING", "1");
    assertEquals(readSymbolMatrixGapMs(), 400);
    Deno.env.set("SYMBOL_MATRIX_GAP_MS", "100");
    assertEquals(readSymbolMatrixGapMs(), 200);
    Deno.env.set("SYMBOL_MATRIX_GAP_MS", "350");
    assertEquals(readSymbolMatrixGapMs(), 350);
    Deno.env.set("SYMBOL_MATRIX_GAP_MS", "4000");
    assertEquals(readSymbolMatrixGapMs(), 4000);
  } finally {
    if (prevGap === undefined) Deno.env.delete("SYMBOL_MATRIX_GAP_MS");
    else Deno.env.set("SYMBOL_MATRIX_GAP_MS", prevGap);
    if (prevMatrix === undefined) Deno.env.delete("AI_PROVIDER_MATRIX");
    else Deno.env.set("AI_PROVIDER_MATRIX", prevMatrix);
    if (prevPreempt === undefined) Deno.env.delete("LLM_PREEMPTIVE_KEY_ROUTING");
    else Deno.env.set("LLM_PREEMPTIVE_KEY_ROUTING", prevPreempt);
  }
});

Deno.test("readSymbolMatrixGapMs legacy serial keeps 2500 minimum", () => {
  const prevGap = Deno.env.get("SYMBOL_MATRIX_GAP_MS");
  const prevMatrix = Deno.env.get("AI_PROVIDER_MATRIX");
  try {
    Deno.env.delete("SYMBOL_MATRIX_GAP_MS");
    Deno.env.set("AI_PROVIDER_MATRIX", "0");
    assertEquals(readSymbolMatrixGapMs(), 2500);
    Deno.env.set("SYMBOL_MATRIX_GAP_MS", "500");
    assertEquals(readSymbolMatrixGapMs(), 2500);
  } finally {
    if (prevGap === undefined) Deno.env.delete("SYMBOL_MATRIX_GAP_MS");
    else Deno.env.set("SYMBOL_MATRIX_GAP_MS", prevGap);
    if (prevMatrix === undefined) Deno.env.delete("AI_PROVIDER_MATRIX");
    else Deno.env.set("AI_PROVIDER_MATRIX", prevMatrix);
  }
});

Deno.test("readAiProviderMatrixEnabled defaults on unless AI_PROVIDER_MATRIX=0", () => {
  const prev = Deno.env.get("AI_PROVIDER_MATRIX");
  try {
    Deno.env.delete("AI_PROVIDER_MATRIX");
    assertEquals(readAiProviderMatrixEnabled(), true);
    Deno.env.set("AI_PROVIDER_MATRIX", "0");
    assertEquals(readAiProviderMatrixEnabled(), false);
  } finally {
    if (prev === undefined) Deno.env.delete("AI_PROVIDER_MATRIX");
    else Deno.env.set("AI_PROVIDER_MATRIX", prev);
  }
});
