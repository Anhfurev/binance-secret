import { assertEquals } from "jsr:@std/assert@1";
import {
  readGroqVetoFastTrackMinConfidence,
  shouldFastTrackGroqBuyVeto,
} from "../ai-veto-helpers.ts";

Deno.test("readGroqVetoFastTrackMinConfidence defaults to 98", () => {
  Deno.env.delete("GROQ_VETO_FAST_TRACK_MIN_CONFIDENCE");
  assertEquals(readGroqVetoFastTrackMinConfidence(), 98);
});

Deno.test("shouldFastTrackGroqBuyVeto skips Groq at high conviction", () => {
  Deno.env.delete("GROQ_VETO_FAST_TRACK_MIN_CONFIDENCE");
  assertEquals(
    shouldFastTrackGroqBuyVeto({
      action: "BUY",
      ai_confidence: 98,
      trend: "bullish",
      trend_alignment: true,
    }),
    true,
  );
  assertEquals(
    shouldFastTrackGroqBuyVeto({
      action: "BUY",
      ai_confidence: 75,
      trend: "bullish",
      trend_alignment: true,
    }),
    false,
  );
  assertEquals(
    shouldFastTrackGroqBuyVeto({
      action: "HOLD",
      ai_confidence: 99,
      trend: "neutral",
      trend_alignment: false,
    }),
    false,
  );
});
