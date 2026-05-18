// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import {
  clearLlmKeyErrorCountProjections,
  getEffectiveLlmKeyErrorCount,
  isLlmErrorCountExhausted,
  readLlmMaxErrorCountPerKey,
  releaseLlmKeyErrorIncrementReservation,
  tryReserveLlmKeyErrorIncrement,
} from "../llm-key-error-count.ts";
import { isLlmApiKeyRowEligible } from "../llm-key-eligibility.ts";
import type { LlmApiKeyRow } from "../llm-api-keys-types.ts";

const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

Deno.test("error_count cap is inclusive (>= max)", () => {
  const prev = Deno.env.get("LLM_API_KEY_MAX_ERROR_COUNT");
  Deno.env.set("LLM_API_KEY_MAX_ERROR_COUNT", "2");
  try {
    assertEquals(readLlmMaxErrorCountPerKey(), 2);
    assertEquals(isLlmErrorCountExhausted(1), false);
    assertEquals(isLlmErrorCountExhausted(2), true);
    assertEquals(isLlmErrorCountExhausted(3), true);
  } finally {
    if (prev === undefined) Deno.env.delete("LLM_API_KEY_MAX_ERROR_COUNT");
    else Deno.env.set("LLM_API_KEY_MAX_ERROR_COUNT", prev);
  }
});

Deno.test("tryReserve blocks parallel third strike on same row", () => {
  clearLlmKeyErrorCountProjections();
  assertEquals(tryReserveLlmKeyErrorIncrement(UUID, 1), true);
  assertEquals(getEffectiveLlmKeyErrorCount(UUID, 1), 2);
  assertEquals(tryReserveLlmKeyErrorIncrement(UUID, 1), false);
  releaseLlmKeyErrorIncrementReservation(UUID);
  clearLlmKeyErrorCountProjections();
});

Deno.test("concurrent reserves: only one wins before cap (max=2, row=1)", async () => {
  const prev = Deno.env.get("LLM_API_KEY_MAX_ERROR_COUNT");
  Deno.env.set("LLM_API_KEY_MAX_ERROR_COUNT", "2");
  clearLlmKeyErrorCountProjections();
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        Promise.resolve(tryReserveLlmKeyErrorIncrement(UUID, 1))
      ),
    );
    const wins = results.filter(Boolean).length;
    assertEquals(wins, 1, `expected 1 reserve win, got ${wins}: ${results}`);
    assertEquals(getEffectiveLlmKeyErrorCount(UUID, 1), 2);
    assertEquals(tryReserveLlmKeyErrorIncrement(UUID, 1), false);
    releaseLlmKeyErrorIncrementReservation(UUID);
    assertEquals(getEffectiveLlmKeyErrorCount(UUID, 1), 1);
    assertEquals(tryReserveLlmKeyErrorIncrement(UUID, 1), true);
  } finally {
    if (prev === undefined) Deno.env.delete("LLM_API_KEY_MAX_ERROR_COUNT");
    else Deno.env.set("LLM_API_KEY_MAX_ERROR_COUNT", prev);
    clearLlmKeyErrorCountProjections();
  }
});

Deno.test("eligibility rejects row at error_count cap", () => {
  const prev = Deno.env.get("LLM_API_KEY_MAX_ERROR_COUNT");
  Deno.env.set("LLM_API_KEY_MAX_ERROR_COUNT", "2");
  try {
    const row: LlmApiKeyRow = {
      id: UUID,
      provider: "groq",
      api_key: "k",
      status: "active",
      cooldown_until: null,
      error_count: 2,
      last_used_at: null,
    };
    assertEquals(isLlmApiKeyRowEligible(row), false);
  } finally {
    if (prev === undefined) Deno.env.delete("LLM_API_KEY_MAX_ERROR_COUNT");
    else Deno.env.set("LLM_API_KEY_MAX_ERROR_COUNT", prev);
  }
});
