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

Deno.test("readSymbolMatrixGapMs defaults 2000ms min 500 with preemptive matrix", () => {
  const prevGap = Deno.env.get("SYMBOL_MATRIX_GAP_MS");
  const prevMatrix = Deno.env.get("AI_PROVIDER_MATRIX");
  const prevPreempt = Deno.env.get("LLM_PREEMPTIVE_KEY_ROUTING");
  const prevCascade = Deno.env.get("AI_CASCADE_PIPELINE");
  try {
    Deno.env.delete("SYMBOL_MATRIX_GAP_MS");
    Deno.env.delete("GEMINI_CRON_SYMBOL_GAP_MS");
    Deno.env.set("AI_CASCADE_PIPELINE", "0");
    Deno.env.set("AI_PROVIDER_MATRIX", "1");
    Deno.env.set("LLM_PREEMPTIVE_KEY_ROUTING", "1");
    assertEquals(readSymbolMatrixGapMs(), 2000);
    Deno.env.set("SYMBOL_MATRIX_GAP_MS", "100");
    assertEquals(readSymbolMatrixGapMs(), 500);
    Deno.env.set("SYMBOL_MATRIX_GAP_MS", "3500");
    assertEquals(readSymbolMatrixGapMs(), 3500);
    Deno.env.set("SYMBOL_MATRIX_GAP_MS", "4000");
    assertEquals(readSymbolMatrixGapMs(), 4000);
  } finally {
    if (prevGap === undefined) Deno.env.delete("SYMBOL_MATRIX_GAP_MS");
    else Deno.env.set("SYMBOL_MATRIX_GAP_MS", prevGap);
    if (prevMatrix === undefined) Deno.env.delete("AI_PROVIDER_MATRIX");
    else Deno.env.set("AI_PROVIDER_MATRIX", prevMatrix);
    if (prevPreempt === undefined) Deno.env.delete("LLM_PREEMPTIVE_KEY_ROUTING");
    else Deno.env.set("LLM_PREEMPTIVE_KEY_ROUTING", prevPreempt);
    if (prevCascade === undefined) Deno.env.delete("AI_CASCADE_PIPELINE");
    else Deno.env.set("AI_CASCADE_PIPELINE", prevCascade);
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
  const prevCascade = Deno.env.get("AI_CASCADE_PIPELINE");
  try {
    Deno.env.set("AI_CASCADE_PIPELINE", "0");
    Deno.env.delete("AI_PROVIDER_MATRIX");
    assertEquals(readAiProviderMatrixEnabled(), true);
    Deno.env.set("AI_PROVIDER_MATRIX", "0");
    assertEquals(readAiProviderMatrixEnabled(), false);
  } finally {
    if (prev === undefined) Deno.env.delete("AI_PROVIDER_MATRIX");
    else Deno.env.set("AI_PROVIDER_MATRIX", prev);
    if (prevCascade === undefined) Deno.env.delete("AI_CASCADE_PIPELINE");
    else Deno.env.set("AI_CASCADE_PIPELINE", prevCascade);
  }
});

Deno.test("readAiProviderMatrixEnabled off when cascade pipeline on", () => {
  const prev = Deno.env.get("AI_CASCADE_PIPELINE");
  const prevMatrix = Deno.env.get("AI_PROVIDER_MATRIX");
  try {
    Deno.env.set("AI_CASCADE_PIPELINE", "1");
    Deno.env.delete("AI_PROVIDER_MATRIX");
    assertEquals(readAiProviderMatrixEnabled(), false);
  } finally {
    if (prev === undefined) Deno.env.delete("AI_CASCADE_PIPELINE");
    else Deno.env.set("AI_CASCADE_PIPELINE", prev);
    if (prevMatrix === undefined) Deno.env.delete("AI_PROVIDER_MATRIX");
    else Deno.env.set("AI_PROVIDER_MATRIX", prevMatrix);
  }
});
