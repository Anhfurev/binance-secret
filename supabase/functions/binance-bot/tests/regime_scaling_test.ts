import { assertEquals } from "jsr:@std/assert";
import {
  resolveRegimeScalingFloors,
  resolveTradeRegime,
} from "../regime-scaling.ts";

Deno.test("resolveTradeRegime maps majors and memes", () => {
  assertEquals(resolveTradeRegime("BTCUSDT", 100_000, 100), "STABLE");
  assertEquals(resolveTradeRegime("PEPEUSDT", 0.00001, 1e-8), "CHAOS");
  assertEquals(resolveTradeRegime("SOLUSDT", 150, 1), "VOLATILE");
});

Deno.test("resolveTradeRegime infers from ATR ratio when symbol is unknown", () => {
  assertEquals(resolveTradeRegime("XYZUSDT", 100, 0.1), "STABLE");
  assertEquals(resolveTradeRegime("XYZUSDT", 100, 0.4), "VOLATILE");
  assertEquals(resolveTradeRegime("XYZUSDT", 100, 1), "CHAOS");
});

Deno.test("resolveRegimeScalingFloors applies stable and chaos floors", () => {
  assertEquals(resolveRegimeScalingFloors("STABLE").minAiConfidence, 62);
  assertEquals(resolveRegimeScalingFloors("STABLE").maxSpreadBps, 10);
  assertEquals(resolveRegimeScalingFloors("CHAOS").minAiConfidence, 78);
  assertEquals(resolveRegimeScalingFloors("CHAOS").maxSpreadBps, 80);
  assertEquals(resolveRegimeScalingFloors("CHAOS").minVolume1mQuoteUsd, 50_000);
});
