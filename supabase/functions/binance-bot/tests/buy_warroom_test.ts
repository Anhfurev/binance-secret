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

Deno.test("oversold bounce matrix reason bypasses War Room quorum at PEPE floor", async () => {
  const result = await resolveWarRoomOutcome({
    supabase: {} as any,
    row: {} as any,
    userId: "user-1",
    symbol: "PEPEUSDT",
    ai: {
      ai_confidence: 52,
      trend: "bearish",
      action: "HOLD",
      sentiment_vibe: { penalty_applied: false },
    } as any,
    regime: "RANGING",
    rawWeighted: 42,
    effectiveConfidence: 42,
    mtf: {},
    bearish1hCap: false,
    ghostMode: false,
    demoProbePaper: false,
    snapshotImbalanceRatio: 1.05,
    confidencePolicy: {
      war_room_base_floor: 78,
      execution_weighted_floor: 70,
      grinder_weighted_floor: 62,
    } as any,
    matrixBuyReason: "oversold_bounce_confirmed_buy|bounce_override_ai_soft_hold",
  });
  assertEquals(result.skipDetail, undefined);
  assertEquals(result.warRoom?.quorum_passed, true);
  assertEquals(result.warRoom?.governance_floor, 35);
});

Deno.test("oversold bounce soft sell PEPE passes quorum at 35% with high technician", async () => {
  const result = await resolveWarRoomOutcome({
    supabase: {} as any,
    row: {} as any,
    userId: "user-1",
    symbol: "PEPEUSDT",
    ai: {
      ai_confidence: 39,
      trend: "bearish",
      action: "SELL",
      sentiment_vibe: { penalty_applied: false },
    } as any,
    regime: "RANGING",
    rawWeighted: 39,
    effectiveConfidence: 39,
    mtf: {},
    bearish1hCap: false,
    ghostMode: false,
    demoProbePaper: false,
    confidencePolicy: {
      war_room_base_floor: 78,
      execution_weighted_floor: 70,
    } as any,
    matrixBuyReason: "oversold_bounce_confirmed_buy|bounce_override_ai_soft_sell",
  });
  assertEquals(result.skipDetail, undefined);
  assertEquals(result.warRoom?.quorum_passed, true);
  assertEquals(result.warRoom?.governance_floor, 35);
});

Deno.test("oversold bounce combined trace bypasses War Room when matrix reason is generic", async () => {
  const result = await resolveWarRoomOutcome({
    supabase: {} as any,
    row: {} as any,
    userId: "user-1",
    symbol: "PEPEUSDT",
    ai: { ai_confidence: 42, trend: "neutral", action: "HOLD" } as any,
    regime: "RANGING",
    rawWeighted: 42,
    effectiveConfidence: 42,
    mtf: {},
    bearish1hCap: false,
    ghostMode: false,
    demoProbePaper: false,
    confidencePolicy: {
      war_room_base_floor: 78,
      execution_weighted_floor: 70,
    } as any,
    matrixBuyReason: "strategy_confirmed_high_conviction_buy",
    combinedStrategyTrace:
      "strategy_oversold_bounce_entry|strategy_confirmed_high_conviction_buy|bounce_override_ai_soft_hold",
  });
  assertEquals(result.skipDetail, undefined);
  assertEquals(result.warRoom?.quorum_passed, true);
  assertEquals(result.warRoom?.governance_floor, 35);
});

Deno.test("oversold bounce uses relaxed SOL 55 floor in War Room", async () => {
  const result = await resolveWarRoomOutcome({
    supabase: {} as any,
    row: {} as any,
    userId: "user-1",
    symbol: "SOLUSDT",
    ai: { ai_confidence: 58, trend: "neutral", action: "HOLD" } as any,
    regime: "RANGING",
    rawWeighted: 56,
    effectiveConfidence: 56,
    mtf: {},
    bearish1hCap: false,
    ghostMode: false,
    demoProbePaper: false,
    confidencePolicy: {
      war_room_base_floor: 78,
      execution_weighted_floor: 70,
    } as any,
    matrixBuyReason: "oversold_bounce_confirmed_buy",
  });
  assertEquals(result.skipDetail, undefined);
  assertEquals(result.warRoom?.governance_floor, 55);
});
