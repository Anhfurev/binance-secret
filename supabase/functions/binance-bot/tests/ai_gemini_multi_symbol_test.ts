import { assertEquals } from "jsr:@std/assert";
import { normalizeAiResponse } from "../ai-models.ts";
import {
  clearGeminiMultiSymbolBatch,
  readGeminiMultiSymbolBatchEnabled,
  setGeminiMultiSymbolBatchResults,
  takeGeminiMultiSymbolBatchAi,
} from "../ai-gemini-multi-symbol.ts";

Deno.test("readGeminiMultiSymbolBatchEnabled follows AI_PRIMARY_LLM and explicit env", () => {
  const prevBatch = Deno.env.get("GEMINI_MULTI_SYMBOL_BATCH");
  const prevPrimary = Deno.env.get("AI_PRIMARY_LLM");
  try {
    Deno.env.delete("GEMINI_MULTI_SYMBOL_BATCH");
    Deno.env.delete("AI_PRIMARY_LLM");
    assertEquals(readGeminiMultiSymbolBatchEnabled(), true);
    Deno.env.set("AI_PRIMARY_LLM", "groq");
    assertEquals(readGeminiMultiSymbolBatchEnabled(), false);
    Deno.env.set("GEMINI_MULTI_SYMBOL_BATCH", "1");
    assertEquals(readGeminiMultiSymbolBatchEnabled(), true);
    Deno.env.set("GEMINI_MULTI_SYMBOL_BATCH", "0");
    assertEquals(readGeminiMultiSymbolBatchEnabled(), false);
  } finally {
    if (prevBatch === undefined) Deno.env.delete("GEMINI_MULTI_SYMBOL_BATCH");
    else Deno.env.set("GEMINI_MULTI_SYMBOL_BATCH", prevBatch);
    if (prevPrimary === undefined) Deno.env.delete("AI_PRIMARY_LLM");
    else Deno.env.set("AI_PRIMARY_LLM", prevPrimary);
  }
});

Deno.test("setGeminiMultiSymbolBatchResults uses shared store with takeGeminiMultiSymbolBatchAi", () => {
  clearGeminiMultiSymbolBatch();
  const m = new Map();
  m.set(
    "ETHUSDT",
    normalizeAiResponse(JSON.stringify({
      trend_score: 40,
      momentum_score: 40,
      volume_score: 40,
      order_book_score: 40,
      trend_alignment: false,
      action: "SELL",
      pro_tip: "fade the rip",
    })),
  );
  setGeminiMultiSymbolBatchResults(m);
  const a = takeGeminiMultiSymbolBatchAi("ETHUSDT");
  assertEquals(a?.action, "SELL");
  clearGeminiMultiSymbolBatch();
  assertEquals(takeGeminiMultiSymbolBatchAi("ETHUSDT"), null);
});
