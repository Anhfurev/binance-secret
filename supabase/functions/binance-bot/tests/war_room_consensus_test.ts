import { assertEquals } from "jsr:@std/assert";
import { resolveConfidencePolicy } from "../confidence-policy.ts";
import { evaluateWarRoomConsensus } from "../war-room.ts";

Deno.test("resolveConfidencePolicy keeps execution floor at or above grinder floor", () => {
  Deno.env.set("PROFESSIONAL_EXPECTANCY_MODE", "1");
  Deno.env.set("GRINDER_MIN_WEIGHTED_CONFIDENCE", "72");
  const policy = resolveConfidencePolicy({ min_ai_confidence: 58 }, {
    marketRegime: "NEUTRAL",
    tradeRegime: "CHAOS",
  });
  assertEquals(
    policy.execution_weighted_floor >= policy.grinder_weighted_floor,
    true,
  );
  Deno.env.delete("GRINDER_MIN_WEIGHTED_CONFIDENCE");
});

Deno.test("evaluateWarRoomConsensus aligns chart leg with 1h bearish cap", () => {
  const warRoom = evaluateWarRoomConsensus({
    rawWeightedConfidence: 80,
    effectiveChartConfidence: 55,
    ai: { action: "BUY", ai_confidence: 80 } as any,
    marketContext: { imbalance_ratio: 1.1 },
    baseRegimeFloor: 58,
    bearish1hCap: true,
  });
  assertEquals(warRoom.quorum_passed, true);
  assertEquals(warRoom.effective_chart_confidence, 55);
});

Deno.test("evaluateWarRoomConsensus lifts governance floor on whale warning", () => {
  const warRoom = evaluateWarRoomConsensus({
    rawWeightedConfidence: 70,
    effectiveChartConfidence: 70,
    ai: { action: "BUY", ai_confidence: 70 } as any,
    marketContext: { imbalance_ratio: 0.3 },
    baseRegimeFloor: 62,
    bearish1hCap: false,
  });
  assertEquals(warRoom.governance_floor, 72);
  assertEquals(warRoom.quorum_passed, false);
});
