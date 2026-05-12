import { assertEquals } from "jsr:@std/assert";
import {
  applySeniorTraderActivityFloors,
  resolveSeniorForceBuyFloors,
  seniorTraderActivityEnabled,
} from "../senior-trader-activity.ts";

Deno.test("senior trader activity defaults on for paper", () => {
  Deno.env.delete("SENIOR_ACTIVITY_MODE");
  assertEquals(seniorTraderActivityEnabled({ is_aggressive_mode: false }, true), true);
  Deno.env.set("SENIOR_ACTIVITY_MODE", "0");
  assertEquals(seniorTraderActivityEnabled({ is_aggressive_mode: false }, true), false);
  Deno.env.delete("SENIOR_ACTIVITY_MODE");
});

Deno.test("applySeniorTraderActivityFloors lowers floors with hard minimums", () => {
  const next = applySeniorTraderActivityFloors({
    minAiConfidence: 58,
    minTechScore: 5,
    enabled: true,
  });
  assertEquals(next.minAiConfidence, 54);
  assertEquals(next.minTechScore, 4);
});

Deno.test("resolveSeniorForceBuyFloors eases force-buy thresholds when active", () => {
  const relaxed = resolveSeniorForceBuyFloors({
    minAiConfidence: 58,
    minTechScore: 5,
    enabled: true,
    forceBuyConfidenceDelta: 0,
  });
  assertEquals(relaxed.techFloor, 5);
  assertEquals(relaxed.confidenceFloor, 60);
});
