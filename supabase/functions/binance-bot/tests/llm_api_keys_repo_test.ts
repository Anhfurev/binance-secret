// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import { readLlmApiKeysDbEnabled } from "../llm-api-keys-repo.ts";

Deno.test("readLlmApiKeysDbEnabled", () => {
  const prev = Deno.env.get("LLM_API_KEYS_DB");
  try {
    Deno.env.delete("LLM_API_KEYS_DB");
    assertEquals(readLlmApiKeysDbEnabled(), false);
    Deno.env.set("LLM_API_KEYS_DB", "1");
    assertEquals(readLlmApiKeysDbEnabled(), true);
  } finally {
    if (prev === undefined) Deno.env.delete("LLM_API_KEYS_DB");
    else Deno.env.set("LLM_API_KEYS_DB", prev);
  }
});
