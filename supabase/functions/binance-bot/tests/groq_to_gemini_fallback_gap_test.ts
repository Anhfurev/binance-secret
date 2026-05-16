import { assertEquals } from "jsr:@std/assert";
import {
  readGroqToGeminiFallbackGapMs,
} from "../groq-request-spacing.ts";

Deno.test("readGroqToGeminiFallbackGapMs defaults to 3000 and enforces minimum", () => {
  const prev = Deno.env.get("GROQ_TO_GEMINI_FALLBACK_GAP_MS");
  try {
    Deno.env.delete("GROQ_TO_GEMINI_FALLBACK_GAP_MS");
    assertEquals(readGroqToGeminiFallbackGapMs(), 3000);
    Deno.env.set("GROQ_TO_GEMINI_FALLBACK_GAP_MS", "500");
    assertEquals(readGroqToGeminiFallbackGapMs(), 3000);
    Deno.env.set("GROQ_TO_GEMINI_FALLBACK_GAP_MS", "4500");
    assertEquals(readGroqToGeminiFallbackGapMs(), 4500);
  } finally {
    if (prev === undefined) Deno.env.delete("GROQ_TO_GEMINI_FALLBACK_GAP_MS");
    else Deno.env.set("GROQ_TO_GEMINI_FALLBACK_GAP_MS", prev);
  }
});
