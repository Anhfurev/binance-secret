import { assertEquals } from "jsr:@std/assert";
import {
  hasAnyAvailableGeminiKey,
  isGeminiKeyAvailable,
} from "../llm-key-backoff.ts";

Deno.test("isGeminiKeyAvailable respects cooldown map", () => {
  const now = 1_000_000;
  const key = "k1";
  assertEquals(isGeminiKeyAvailable(key, {}, now), true);
  assertEquals(isGeminiKeyAvailable(key, { [key]: now + 5000 }, now), false);
  assertEquals(hasAnyAvailableGeminiKey(["a", "b"], { a: now + 9999 }, now), true);
  assertEquals(hasAnyAvailableGeminiKey(["a"], { a: now + 9999 }, now), false);
  assertEquals(hasAnyAvailableGeminiKey(["a", "b"], { a: now + 9999, b: now + 9999 }, now), false);
});
