import { assertEquals } from "jsr:@std/assert";
import { normalizeAiResponse } from "../ai-models.ts";
import {
  clearGroqMultiSymbolBatch,
  readGroqMultiSymbolBatchEnabled,
  setGroqMultiSymbolBatchResults,
  takeGroqMultiSymbolBatchAi,
} from "../ai-groq-multi-symbol.ts";

Deno.test("readGroqMultiSymbolBatchEnabled follows AI_PRIMARY_LLM and explicit env", () => {
  const prevBatch = Deno.env.get("GROQ_MULTI_SYMBOL_BATCH");
  const prevPrimary = Deno.env.get("AI_PRIMARY_LLM");
  try {
    Deno.env.delete("GROQ_MULTI_SYMBOL_BATCH");
    Deno.env.delete("AI_PRIMARY_LLM");
    assertEquals(readGroqMultiSymbolBatchEnabled(), false);
    Deno.env.set("AI_PRIMARY_LLM", "groq");
    assertEquals(readGroqMultiSymbolBatchEnabled(), true);
    Deno.env.set("GROQ_MULTI_SYMBOL_BATCH", "0");
    assertEquals(readGroqMultiSymbolBatchEnabled(), false);
    Deno.env.set("GROQ_MULTI_SYMBOL_BATCH", "1");
    assertEquals(readGroqMultiSymbolBatchEnabled(), true);
  } finally {
    if (prevBatch === undefined) Deno.env.delete("GROQ_MULTI_SYMBOL_BATCH");
    else Deno.env.set("GROQ_MULTI_SYMBOL_BATCH", prevBatch);
    if (prevPrimary === undefined) Deno.env.delete("AI_PRIMARY_LLM");
    else Deno.env.set("AI_PRIMARY_LLM", prevPrimary);
  }
});

Deno.test("takeGroqMultiSymbolBatchAi returns clone and risk_review maps to groq_verdict", () => {
  clearGroqMultiSymbolBatch();
  const m = new Map();
  m.set(
    "BTCUSDT",
    normalizeAiResponse(JSON.stringify({
      trend_score: 50,
      momentum_score: 50,
      volume_score: 50,
      order_book_score: 50,
      trend_alignment: true,
      action: "HOLD",
      pro_tip: "compact tape",
      risk_review_verdict: "APPROVE",
      risk_review_reason: "inline ok",
    })),
  );
  setGroqMultiSymbolBatchResults(m);
  const a = takeGroqMultiSymbolBatchAi("BTCUSDT");
  assertEquals(a?.action, "HOLD");
  assertEquals(a?.groq_verdict, "APPROVE");
  assertEquals(a?.groq_reason?.includes("inline"), true);
  clearGroqMultiSymbolBatch();
  assertEquals(takeGroqMultiSymbolBatchAi("BTCUSDT"), null);
});
