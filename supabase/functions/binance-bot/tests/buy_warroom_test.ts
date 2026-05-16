import { assertEquals } from "jsr:@std/assert";
import { resolveWarRoomOutcome } from "../buy-warroom.ts";

Deno.test("demo probe paper bypasses War Room quorum gates", async () => {
  const result = await resolveWarRoomOutcome({
    supabase: {} as any,
    row: {} as any,
    userId: "user-1",
    symbol: "PEPEUSDT",
    ai: { ai_confidence: 55, trend: "bullish" } as any,
    regime: "NEUTRAL",
    rawWeighted: 55,
    effectiveConfidence: 55,
    mtf: {},
    bearish1hCap: false,
    ghostMode: false,
    demoProbePaper: true,
    confidencePolicy: {
      war_room_base_floor: 78,
      execution_weighted_floor: 78,
      grinder_weighted_floor: 62,
    } as any,
  });
  assertEquals(result.skipDetail, undefined);
  assertEquals(result.executionConfidence, 55);
  assertEquals(result.warRoom?.quorum_passed, true);
});

Deno.test("bearish 1h bounce bypasses quorum when raw clears governance floor", async () => {
  const result = await resolveWarRoomOutcome({
    supabase: {} as any,
    row: {} as any,
    userId: "user-1",
    symbol: "BTCUSDT",
    ai: { ai_confidence: 58, trend: "bullish" } as any,
    regime: "NEUTRAL",
    rawWeighted: 58,
    effectiveConfidence: 54,
    mtf: {},
    bearish1hCap: true,
    ghostMode: false,
    demoProbePaper: false,
    snapshotImbalanceRatio: 1.1,
    confidencePolicy: {
      war_room_base_floor: 58,
      execution_weighted_floor: 58,
      grinder_weighted_floor: 58,
    } as any,
  });
  assertEquals(result.skipDetail, undefined);
  assertEquals(result.executionConfidence, 54);
  assertEquals(result.warRoom?.quorum_passed, true);
  assertEquals(result.warRoom?.final_governance, "quorum_met");
});
