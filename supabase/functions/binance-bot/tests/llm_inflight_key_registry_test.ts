import { assertEquals } from "jsr:@std/assert";
import {
  clearLlmBatchKeyRegistry,
  countLaneKeysAvailable,
  isLlmKeyBatchEvicted,
  isLlmKeyInFlightBusy,
  isLlmKeyUnavailable,
  listBatchFailedDbIds,
  markLlmKeyBatchBlocked,
  markLlmKeyBatchFailed,
  releaseLlmKeyInflight,
  registerLlmKeyFailureFromError,
  resolveGeminiKeyLockId,
  resolveGroqKeyLockId,
  tryAcquireLlmKey,
} from "../llm-inflight-key-registry.ts";
import { LlmHttpError } from "../llm-http-error.ts";

const DB_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

Deno.test("inflight registry blocks double acquire and live-429 batch-failed keys", () => {
  clearLlmBatchKeyRegistry();
  const id = resolveGroqKeyLockId("secret-a", DB_UUID);
  assertEquals(tryAcquireLlmKey(id, DB_UUID), true);
  assertEquals(tryAcquireLlmKey(id, DB_UUID), false);
  releaseLlmKeyInflight(id, "success");
  assertEquals(tryAcquireLlmKey(id, DB_UUID), true);
  registerLlmKeyFailureFromError(id, new LlmHttpError("rl", 429, ""), DB_UUID);
  assertEquals(isLlmKeyUnavailable(id, DB_UUID), true);
  assertEquals(listBatchFailedDbIds(), [DB_UUID]);
  assertEquals(tryAcquireLlmKey(id, DB_UUID), false);
});

Deno.test("inflight busy is not batch-evicted", () => {
  clearLlmBatchKeyRegistry();
  const id = resolveGroqKeyLockId("busy-only", DB_UUID);
  assertEquals(tryAcquireLlmKey(id, DB_UUID), true);
  assertEquals(isLlmKeyInFlightBusy(id, DB_UUID), true);
  assertEquals(isLlmKeyBatchEvicted(id, DB_UUID), false);
  assertEquals(isLlmKeyUnavailable(id, DB_UUID), true);
  releaseLlmKeyInflight(id, "success");
  assertEquals(isLlmKeyInFlightBusy(id, DB_UUID), false);
});

Deno.test("duplicate gemini slots share one secret inflight lock", () => {
  clearLlmBatchKeyRegistry();
  const slotA = { value: "same-secret", label: "env", llmDbKeyId: "row-a" };
  const slotB = { value: "same-secret", label: "env2", llmDbKeyId: "row-b" };
  const lockA = resolveGeminiKeyLockId(slotA);
  const lockB = resolveGeminiKeyLockId(slotB);
  assertEquals(lockA, lockB);
  assertEquals(tryAcquireLlmKey(lockA, "row-a"), true);
  assertEquals(tryAcquireLlmKey(lockB, "row-b"), false);
});

Deno.test("countLaneKeysAvailable excludes busy and cooled indices", () => {
  clearLlmBatchKeyRegistry();
  const order = [0, 1, 2];
  const lock = (i: number) => resolveGroqKeyLockId(`k${i}`, `00000000-0000-4000-8000-00000000000${i}`);
  registerLlmKeyFailureFromError(
    lock(1),
    new LlmHttpError("rl", 429, ""),
    `00000000-0000-4000-8000-000000000001`,
  );
  const left = countLaneKeysAvailable(
    order,
    lock,
    (i) => i === 2,
    undefined,
  );
  assertEquals(left, 1);
});

Deno.test("blocked keys are unavailable but not in batchFailed", () => {
  clearLlmBatchKeyRegistry();
  const blockedId = "b2b3c4d5-e6f7-8901-bcde-f12345678901";
  const id = resolveGroqKeyLockId("secret-b", blockedId);
  registerLlmKeyFailureFromError(id, new LlmHttpError("dead", 403, ""), blockedId);
  assertEquals(isLlmKeyUnavailable(id, blockedId), true);
  assertEquals(tryAcquireLlmKey(id, blockedId), false);
});
