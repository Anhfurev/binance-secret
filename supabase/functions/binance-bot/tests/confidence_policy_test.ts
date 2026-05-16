import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveConfidencePolicy,
  resolveGrinderWeightedFloor,
  resolveMarketRegimeMinAiConfidence,
} from "../confidence-policy.ts";

const row = { min_ai_confidence: 58 };

Deno.test("resolveConfidencePolicy unifies CHAOS execution floor", () => {
  Deno.env.delete("CONFIDENCE_POLICY_AGGRESSION_DELTA");
  Deno.env.delete("TRADE_REGIME_CHAOS_WEIGHTED_FLOOR");
  Deno.env.set("PROFESSIONAL_EXPECTANCY_MODE", "1");
  Deno.env.set("GRINDER_MIN_WEIGHTED_CONFIDENCE", "72");
  const policy = resolveConfidencePolicy(row, {
    marketRegime: "NEUTRAL",
    tradeRegime: "CHAOS",
  });
  assertEquals(policy.trade_regime_weighted_floor, 78);
  assertEquals(policy.grinder_weighted_floor, 68);
  assertEquals(policy.execution_weighted_floor, 78);
  assertEquals(policy.war_room_base_floor, 78);
  Deno.env.delete("GRINDER_MIN_WEIGHTED_CONFIDENCE");
});

Deno.test("resolveMarketRegimeMinAiConfidence honors trending override", () => {
  assertEquals(
    resolveMarketRegimeMinAiConfidence({ min_ai_confidence: 58, min_ai_confidence_trending: 64 }, "TRENDING"),
    64,
  );
});

Deno.test("resolveGrinderWeightedFloor caps sideways grinder", () => {
  Deno.env.set("PROFESSIONAL_EXPECTANCY_MODE", "1");
  Deno.env.set("GRINDER_MIN_WEIGHTED_CONFIDENCE", "72");
  assertEquals(resolveGrinderWeightedFloor("RANGING"), 68);
  Deno.env.delete("GRINDER_MIN_WEIGHTED_CONFIDENCE");
});

Deno.test("CONFIDENCE_POLICY_AGGRESSION_DELTA lowers trade regime floor", () => {
  Deno.env.set("CONFIDENCE_POLICY_AGGRESSION_DELTA", "5");
  const policy = resolveConfidencePolicy(row, {
    marketRegime: "NEUTRAL",
    tradeRegime: "CHAOS",
  });
  assertEquals(policy.trade_regime_weighted_floor, 73);
  assertEquals(policy.execution_weighted_floor, 73);
  Deno.env.delete("CONFIDENCE_POLICY_AGGRESSION_DELTA");
});
