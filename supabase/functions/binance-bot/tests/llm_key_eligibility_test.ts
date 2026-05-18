// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import { isLlmApiKeyRowEligible } from "../llm-key-eligibility.ts";
import type { LlmApiKeyRow } from "../llm-api-keys-types.ts";
import {
  clearLocalLlmKeyCooldownRegistry,
  markLocalLlmKeyCooldown,
} from "../llm-local-cooldown-registry.ts";

function row(partial: Partial<LlmApiKeyRow>): LlmApiKeyRow {
  return {
    id: partial.id ?? "a",
    provider: "groq",
    api_key: "k",
    status: partial.status ?? "active",
    cooldown_until: partial.cooldown_until ?? null,
    error_count: 0,
    last_used_at: null,
  };
}

Deno.test("isLlmApiKeyRowEligible rejects future cooldown_until UTC", () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  assertEquals(isLlmApiKeyRowEligible(row({ cooldown_until: future })), false);
  const past = new Date(Date.now() - 3600_000).toISOString();
  assertEquals(isLlmApiKeyRowEligible(row({ status: "cooldown", cooldown_until: past })), true);
});

Deno.test("isLlmApiKeyRowEligible rejects local ledger id", () => {
  clearLocalLlmKeyCooldownRegistry();
  const id = "22222222-2222-2222-2222-222222222222";
  markLocalLlmKeyCooldown({ dbRowId: id });
  assertEquals(isLlmApiKeyRowEligible(row({ id })), false);
  clearLocalLlmKeyCooldownRegistry();
});
