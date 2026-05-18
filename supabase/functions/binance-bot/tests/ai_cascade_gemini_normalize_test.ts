// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import { normalizeCascadeGeminiResponse } from "../ai-cascade-gemini-normalize.ts";

Deno.test("normalizeCascadeGeminiResponse maps isSetupValid to BUY/HOLD", () => {
  const valid = normalizeCascadeGeminiResponse(
    '{"isSetupValid":true,"structuralReasoning":"Pullback to support with long lower wicks."}',
  );
  assertEquals(valid.action, "BUY");
  assertEquals(valid.is_setup_valid, true);
  assertEquals(valid.structural_reasoning?.includes("Pullback"), true);

  const invalid = normalizeCascadeGeminiResponse(
    '{"isSetupValid":false,"structuralReasoning":"Breakdown below pivot."}',
  );
  assertEquals(invalid.action, "HOLD");
  assertEquals(invalid.is_setup_valid, false);
});
