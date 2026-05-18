import { assertEquals } from "jsr:@std/assert";
import { normalizeAiResponse } from "../ai-normalize-model-response.ts";
import { normalizeCascadeGeminiResponse } from "../ai-cascade-gemini-normalize.ts";
import { expandCascadeGeminiKeys, expandGeminiOutputKeys } from "../gemini-output-expand.ts";

Deno.test("expandGeminiOutputKeys maps minified scan keys", () => {
  const expanded = expandGeminiOutputKeys({
    a: "BUY",
    al: 1,
    ts: 80,
    ms: 70,
    vs: 60,
    os: 55,
    p: "Tight stop under support",
  });
  assertEquals(expanded.action, "BUY");
  assertEquals(expanded.trend_alignment, true);
  assertEquals(expanded.trend_score, 80);
});

Deno.test("normalizeAiResponse accepts minified JSON", () => {
  const ai = normalizeAiResponse(
    '{"a":"HOLD","al":0,"ts":40,"ms":35,"vs":30,"os":25,"p":"Wait for HTF align"}',
  );
  assertEquals(ai.action, "HOLD");
  assertEquals(ai.trend_alignment, false);
});

Deno.test("expandGeminiOutputKeys maps ultra-min a,c keys", () => {
  const expanded = expandGeminiOutputKeys({ a: "BUY", c: 85.5 });
  assertEquals(expanded.action, "BUY");
  assertEquals(expanded.ai_confidence_override, 86);
  assertEquals(expanded.trend_score, 86);
});

Deno.test("normalizeAiResponse strips fences and accepts compact JSON", () => {
  const ai = normalizeAiResponse("```json\n{\"a\":\"HOLD\",\"c\":40}\n```");
  assertEquals(ai.action, "HOLD");
  assertEquals(ai.ai_confidence, 40);
});

Deno.test("normalizeCascadeGeminiResponse accepts minified v/r keys", () => {
  const ai = normalizeCascadeGeminiResponse('{"v":1,"r":"Absorption at support"}');
  assertEquals(ai.action, "BUY");
  assertEquals(String(ai.structural_reasoning).includes("Absorption"), true);
});
