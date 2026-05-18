// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import {
  approximateGeminiTokenCount,
  isGeminiCachePayloadClientError,
  isGeminiContextCacheEligible,
  MIN_CACHE_TOKENS,
} from "../gemini-token-estimate.ts";
import { readGeminiContextCacheEnabled } from "../gemini-context-cache.ts";
import {
  clearGeminiContextCacheForTests,
  resolveGeminiCachedContent,
} from "../gemini-context-cache.ts";

Deno.test("MIN_CACHE_TOKENS gate blocks small system prompts", () => {
  assertEquals(MIN_CACHE_TOKENS, 2048);
  assertEquals(isGeminiContextCacheEligible("short prompt"), false);
  const big = "x".repeat(MIN_CACHE_TOKENS * 4);
  assertEquals(isGeminiContextCacheEligible(big), true);
  assertEquals(approximateGeminiTokenCount(big), MIN_CACHE_TOKENS);
});

Deno.test("detects Gemini cache-too-small client error text", () => {
  const msg =
    'INVALID_ARGUMENT: Cached content is too small. total_token_count=118, min_total_token_count=2048';
  assertEquals(isGeminiCachePayloadClientError(msg), true);
});

Deno.test("resolveGeminiCachedContent skips HTTP when below token floor", async () => {
  const prev = Deno.env.get("GEMINI_CONTEXT_CACHE_ENABLED");
  Deno.env.set("GEMINI_CONTEXT_CACHE_ENABLED", "1");
  clearGeminiContextCacheForTests();
  try {
    assertEquals(readGeminiContextCacheEnabled(), true);
    const name = await resolveGeminiCachedContent(
      "test-key-not-used",
      "scan",
      "tiny system",
    );
    assertEquals(name, null);
  } finally {
    clearGeminiContextCacheForTests();
    if (prev === undefined) Deno.env.delete("GEMINI_CONTEXT_CACHE_ENABLED");
    else Deno.env.set("GEMINI_CONTEXT_CACHE_ENABLED", prev);
  }
});
