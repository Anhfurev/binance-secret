import { assertEquals } from "jsr:@std/assert";
import {
  applyLiveStylePracticeFloors,
  paperLiveStylePracticeEnabled,
} from "../live-style-practice.ts";

Deno.test("paperLiveStylePracticeEnabled defaults on for paper", () => {
  Deno.env.delete("PAPER_LIVE_STYLE_PRACTICE");
  assertEquals(paperLiveStylePracticeEnabled(true), true);
  assertEquals(paperLiveStylePracticeEnabled(false), false);
});

Deno.test("applyLiveStylePracticeFloors raises weak paper floors", () => {
  const out = applyLiveStylePracticeFloors({
    minAiConfidence: 50,
    minTechScore: 4,
    enabled: true,
  });
  assertEquals(out.minAiConfidence, 54);
  assertEquals(out.minTechScore, 6);
});
