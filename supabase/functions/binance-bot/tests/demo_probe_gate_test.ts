import { assertEquals } from "jsr:@std/assert@1";
import { passesDemoPaperProbeQualityGate } from "../demo-paper-probe-buy.ts";

Deno.test("demo probe gate rejects non-strategy buys", () => {
  const ok = passesDemoPaperProbeQualityGate({
    strategySignal: "HOLD",
    technicalScore: 8,
    minTech: 4,
    minAiConfidence: 50,
    ai: { ai_confidence: 80, trend: "bullish" } as any,
    groqRejected: false,
  });
  assertEquals(ok, false);
});
