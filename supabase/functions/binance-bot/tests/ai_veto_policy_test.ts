// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import {
  applyStaleSignalBuyVeto,
  hasFinalGroqBuyVeto,
  shouldFastTrackGroqBuyVeto,
} from "../ai-veto-helpers.ts";
import { GLOBAL_BOT_CONFIG, IS_TEST_MODE } from "../config.ts";
import type { AiAnalysis, IndicatorSnapshot } from "../types.ts";

function stubAi(over: Partial<AiAnalysis>): AiAnalysis {
  return {
    ai_confidence: 50,
    trend: "bullish",
    trend_alignment: true,
    action: "HOLD",
    ...over,
  };
}

/** Default env + `shouldFastTrackGroqBuyVeto` cases (single setup). */
Deno.test("Groq veto fast-track: GLOBAL_BOT_CONFIG threshold and shouldFastTrackGroqBuyVeto", () => {
  const prevModel = Deno.env.get("GROQ_MODEL");
  const prevExec = Deno.env.get("GROQ_EXECUTION_MODEL");
  try {
    Deno.env.set("GROQ_MODEL", "mixtral-8x7b-32768");
    Deno.env.delete("GROQ_EXECUTION_MODEL");
    Deno.env.delete("GROQ_VETO_FAST_TRACK_MIN_CONFIDENCE");
    const floor = IS_TEST_MODE ? 0 : 90;
    assertEquals(GLOBAL_BOT_CONFIG.GROQ_VETO_FAST_TRACK_MIN_CONFIDENCE, floor);
    assertEquals(shouldFastTrackGroqBuyVeto(stubAi({ action: "BUY", ai_confidence: 90 })), true);
    assertEquals(
      shouldFastTrackGroqBuyVeto(stubAi({ action: "BUY", ai_confidence: 75 })),
      IS_TEST_MODE,
    );
    assertEquals(shouldFastTrackGroqBuyVeto(stubAi({ action: "HOLD", ai_confidence: 99 })), false);
  } finally {
    if (prevModel === undefined) Deno.env.delete("GROQ_MODEL");
    else Deno.env.set("GROQ_MODEL", prevModel);
    if (prevExec === undefined) Deno.env.delete("GROQ_EXECUTION_MODEL");
    else Deno.env.set("GROQ_EXECUTION_MODEL", prevExec);
  }
});

Deno.test("hasFinalGroqBuyVeto recognizes terminal veto verdicts", () => {
  assertEquals(hasFinalGroqBuyVeto(stubAi({ groq_verdict: "APPROVE" })), true);
  assertEquals(hasFinalGroqBuyVeto(stubAi({ groq_verdict: "SKIPPED" })), true);
  assertEquals(hasFinalGroqBuyVeto(stubAi({})), false);
});

Deno.test("applyStaleSignalBuyVeto rejects BUY on three red 1m candles", () => {
  const prev = Deno.env.get("VETO_STALE_SIGNAL");
  try {
    Deno.env.set("VETO_STALE_SIGNAL", "1");
    const snapshot = {
      symbol: "BTCUSDT",
      latestPrice: 100,
      candles5: [
        { openTime: 1, open: 101, high: 101, low: 99, close: 100, volume: 1 },
        { openTime: 2, open: 100, high: 100, low: 98, close: 99, volume: 1 },
        { openTime: 3, open: 99, high: 99, low: 97, close: 98, volume: 1 },
      ],
    } as unknown as IndicatorSnapshot;
    const next = applyStaleSignalBuyVeto(snapshot, stubAi({ action: "BUY", ai_confidence: 80 }));
    if (IS_TEST_MODE) {
      assertEquals(next.action, "BUY");
      assertEquals(next.groq_verdict, undefined);
    } else {
      assertEquals(next.action, "HOLD");
      assertEquals(next.groq_verdict, "REJECT");
    }
  } finally {
    if (prev === undefined) Deno.env.delete("VETO_STALE_SIGNAL");
    else Deno.env.set("VETO_STALE_SIGNAL", prev);
  }
});
