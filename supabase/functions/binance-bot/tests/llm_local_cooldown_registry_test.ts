// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import {
  clearLocalLlmKeyCooldownRegistry,
  isLlmKeyLocallyCooling,
  markLocalLlmKeyCooldown,
  readLocalCooldownUntilMs,
} from "../llm-local-cooldown-registry.ts";
import {
  clearLlmBatchKeyRegistry,
  isLlmKeyUnavailable,
  tryAcquireLlmKey,
} from "../llm-inflight-key-registry.ts";

Deno.test("local cooldown blocks parallel lanes before DB propagates", () => {
  clearLlmBatchKeyRegistry();
  const dbId = "11111111-1111-1111-1111-111111111111";
  const lockId = `groq:db:${dbId}`;
  const until = Date.now() + 60_000;
  markLocalLlmKeyCooldown({ dbRowId: dbId, lockId, untilMs: until });
  assertEquals(isLlmKeyLocallyCooling(dbId, lockId), true);
  assertEquals(isLlmKeyUnavailable(lockId, dbId), true);
  assertEquals(tryAcquireLlmKey(lockId, dbId), false);
  clearLocalLlmKeyCooldownRegistry();
  assertEquals(readLocalCooldownUntilMs(dbId, lockId), null);
});
