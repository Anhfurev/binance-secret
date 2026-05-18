// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import { buildGeminiStructuralSummary } from "../ai-cascade-summary.ts";

Deno.test("buildGeminiStructuralSummary prefers structural_reasoning", () => {
  const s = buildGeminiStructuralSummary({
    action: "BUY",
    structural_reasoning: "Pullback held daily S1 with rejection wicks.",
    reason: "fallback reason",
  } as any);
  assertEquals(s, "Pullback held daily S1 with rejection wicks.");
});
