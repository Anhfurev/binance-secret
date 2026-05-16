import { assertEquals } from "jsr:@std/assert";
import {
  resolveSessionAwareMinAiConfidence,
  resolveVolumeSpikeMultiplier,
} from "../decision-tuning.ts";

Deno.test("resolveVolumeSpikeMultiplier uses meme bucket for PEPE", () => {
  assertEquals(resolveVolumeSpikeMultiplier("PEPEUSDT"), 2.3);
  assertEquals(resolveVolumeSpikeMultiplier("BTCUSDT"), 1.5);
});

Deno.test("resolveSessionAwareMinAiConfidence eases during high-liquidity UTC hours", () => {
  const out = resolveSessionAwareMinAiConfidence({
    baseMinAiConfidence: 70,
    avgVolume1m: 10,
    lastCandleVolume: 10,
    now: new Date("2026-05-12T15:00:00.000Z"),
  });
  assertEquals(out.sessionBand, "high");
  assertEquals(out.adjustedMinAiConfidence, 68);
});

Deno.test("resolveSessionAwareMinAiConfidence tightens on dry volume", () => {
  const out = resolveSessionAwareMinAiConfidence({
    baseMinAiConfidence: 70,
    avgVolume1m: 10,
    lastCandleVolume: 6,
    now: new Date("2026-05-12T08:00:00.000Z"),
  });
  assertEquals(out.adjustedMinAiConfidence, 74);
});
