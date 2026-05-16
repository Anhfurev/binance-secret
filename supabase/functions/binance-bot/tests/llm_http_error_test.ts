// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import { isLlmHttpError, LlmHttpError } from "../llm-http-error.ts";

Deno.test("LlmHttpError carries status and snippet", () => {
  const e = new LlmHttpError("x", 429, "body");
  assertEquals(isLlmHttpError(e), true);
  assertEquals(e.status, 429);
  assertEquals(e.bodySnippet, "body");
});
