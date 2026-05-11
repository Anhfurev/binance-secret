import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readLlmMaxConcurrent } from "../ai-llm-concurrency.ts";

Deno.test("readLlmMaxConcurrent defaults to 3", () => {
  assertEquals(readLlmMaxConcurrent(), 3);
});
