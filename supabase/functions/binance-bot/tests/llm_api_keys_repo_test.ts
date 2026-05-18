// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import {
  buildLlmApiKeysCooldownOrFilter,
  readLlmApiKeysDbEnabled,
} from "../llm-api-keys-repo.ts";

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

Deno.test("buildLlmApiKeysCooldownOrFilter uses UTC ISO for PostgREST OR", () => {
  const iso = "2026-05-22T12:00:00.000Z";
  const or = buildLlmApiKeysCooldownOrFilter(iso);
  assertEquals(or, "cooldown_until.is.null,cooldown_until.lt.2026-05-22T12:00:00.000Z");
});
