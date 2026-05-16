import { assertEquals } from "jsr:@std/assert";
import {
  readMinAdxForBuyContextGate,
  readPaperWeightedFloorRelaxPoints,
} from "../buy-helpers.ts";

Deno.test("readMinAdxForBuyContextGate softens paper chop vs live", () => {
  assertEquals(readMinAdxForBuyContextGate({ isPaperOnly: false, paperLiveStylePractice: false }), 18);
  assertEquals(readMinAdxForBuyContextGate({ isPaperOnly: true, paperLiveStylePractice: false }), 14);
  assertEquals(readMinAdxForBuyContextGate({ isPaperOnly: true, paperLiveStylePractice: true }), 22);
});

Deno.test("readPaperWeightedFloorRelaxPoints defaults to seven", () => {
  Deno.env.delete("PAPER_WEIGHTED_FLOOR_RELAX_PCT");
  assertEquals(readPaperWeightedFloorRelaxPoints(), 7);
});
