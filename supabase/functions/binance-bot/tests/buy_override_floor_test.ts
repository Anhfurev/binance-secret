import { assertEquals } from "jsr:@std/assert";
import {
  FORCE_BUY_OVERRIDE_FLOOR_PCT,
  isConfirmedForceBuyOverrideStamp,
  relaxConfidencePolicyForForceBuyOverride,
  relaxMinWeightedEntryForForceBuyOverride,
  resolveForceBuyOverrideMinAiConfidenceBuy,
} from "../buy-override-floor.ts";
import { resolveConfidencePolicy } from "../confidence-policy.ts";

Deno.test("isConfirmedForceBuyOverrideStamp matches force and btc overbought stamps", () => {
  assertEquals(
    isConfirmedForceBuyOverrideStamp("buy|force_buy_override: ai_confidence=72, tech_score=9"),
    true,
  );
  assertEquals(
    isConfirmedForceBuyOverrideStamp("buy|btc_overbought_strong_buy_override"),
    true,
  );
  assertEquals(isConfirmedForceBuyOverrideStamp("aggressive_buy_confirmed_orderbook"), false);
});

Deno.test("relaxConfidencePolicyForForceBuyOverride caps VOLATILE 70 floor to 55", () => {
  const raw = resolveConfidencePolicy({}, { marketRegime: "NEUTRAL", tradeRegime: "VOLATILE" });
  assertEquals(raw.execution_weighted_floor >= 70, true);
  const relaxed = relaxConfidencePolicyForForceBuyOverride(raw);
  assertEquals(relaxed.execution_weighted_floor, FORCE_BUY_OVERRIDE_FLOOR_PCT);
});

Deno.test("resolveForceBuyOverrideMinAiConfidenceBuy allows 68% conviction when tech >= 9", () => {
  const floor = resolveForceBuyOverrideMinAiConfidenceBuy({
    executionWeightedFloor: 70,
    assetClassMinAi: 70,
    effectiveConfidence: 68,
    rawAiConfidence: 72,
    technicalScore: 9,
  });
  assertEquals(floor, 55);
  assertEquals(68 >= floor, true);
});

Deno.test("resolveForceBuyOverrideMinAiConfidenceBuy uses 55 cap when tech below 9", () => {
  assertEquals(
    resolveForceBuyOverrideMinAiConfidenceBuy({
      executionWeightedFloor: 70,
      assetClassMinAi: 70,
      effectiveConfidence: 68,
      rawAiConfidence: 72,
      technicalScore: 8,
    }),
    55,
  );
});

Deno.test("relaxMinWeightedEntryForForceBuyOverride lowers floor for tech 9", () => {
  assertEquals(
    relaxMinWeightedEntryForForceBuyOverride({
      minWeightedEntry: 70,
      rawWeighted: 66,
      rawAiConfidence: 72,
      technicalScore: 9,
    }),
    66,
  );
});
