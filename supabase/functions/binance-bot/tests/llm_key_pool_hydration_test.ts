// @ts-nocheck
import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  clearCronBatchLlmKeyPools,
  publishCronBatchLlmKeyPools,
} from "../llm-key-preemptive-route.ts";
import {
  getCronLlmKeyPool,
  isCronLlmKeyPoolHydrated,
  resetCronLlmKeyPool,
  resolveCronLlmKeyPool,
} from "../llm-key-pool.ts";

const GROQ_PLAN = {
  scanKeys: ["sk-scan-a", "sk-scan-b"],
  vetoKeys: ["sk-veto-a"],
  scanDbIds: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
  vetoDbIds: ["00000000-0000-4000-8000-000000000003"],
  scanDbErrorCounts: [],
  vetoDbErrorCounts: [],
  scanDbStatuses: [],
  vetoDbStatuses: [],
  scanDbCooldownUntils: [],
  vetoDbCooldownUntils: [],
  useDbHardTimeout: false,
  source: "env" as const,
};

const BATCH_A = "batch-aaaa-1111";
const BATCH_B = "batch-bbbb-2222";

Deno.test("publishCronBatchLlmKeyPools hydrates before getCronLlmKeyPool", () => {
  clearCronBatchLlmKeyPools();
  const result = publishCronBatchLlmKeyPools({
    groqPlan: GROQ_PLAN,
    geminiSlots: [{ value: "gemini-key-a", label: "test" }],
    fetchedAtMs: Date.now(),
  }, BATCH_A);
  assertEquals(result.hydrated, true);
  assertEquals(isCronLlmKeyPoolHydrated(BATCH_A), true);
  assertEquals(getCronLlmKeyPool(BATCH_A).getStats("gemini").total, 1);
  assertEquals(getCronLlmKeyPool(BATCH_A).getStats("groq").total, 3);
  resetCronLlmKeyPool(BATCH_A);
  assertEquals(isCronLlmKeyPoolHydrated(BATCH_A), false);
});

Deno.test("hydrated with groq only when gemini secrets empty", () => {
  clearCronBatchLlmKeyPools();
  const result = publishCronBatchLlmKeyPools({
    groqPlan: GROQ_PLAN,
    geminiSlots: [{ value: "", label: "empty" }],
    fetchedAtMs: Date.now(),
  }, BATCH_A);
  assertEquals(result.hydrated, true);
  assertEquals(getCronLlmKeyPool(BATCH_A).getStats("groq").total, 3);
});

Deno.test("commit fails when no keys registered", () => {
  clearCronBatchLlmKeyPools();
  const result = publishCronBatchLlmKeyPools({
    groqPlan: { ...GROQ_PLAN, scanKeys: [], vetoKeys: [] },
    geminiSlots: [],
    fetchedAtMs: Date.now(),
  }, BATCH_A);
  assertEquals(result.hydrated, false);
  assertEquals(isCronLlmKeyPoolHydrated(BATCH_A), false);
});

Deno.test("stale janitor cleanup does not clear active batch pool", () => {
  clearCronBatchLlmKeyPools();
  publishCronBatchLlmKeyPools({
    groqPlan: GROQ_PLAN,
    geminiSlots: [{ value: "gemini-key-a", label: "test" }],
    fetchedAtMs: Date.now(),
  }, BATCH_B);
  assertEquals(isCronLlmKeyPoolHydrated(BATCH_B), true);
  clearCronBatchLlmKeyPools(BATCH_A);
  assertEquals(isCronLlmKeyPoolHydrated(BATCH_B), true);
  assertEquals(resolveCronLlmKeyPool(BATCH_B)?.getStats("groq").total, 3);
  clearCronBatchLlmKeyPools(BATCH_B);
  assertEquals(isCronLlmKeyPoolHydrated(BATCH_B), false);
});

Deno.test("micro-hydrate restores pool after accidental reset", () => {
  clearCronBatchLlmKeyPools();
  publishCronBatchLlmKeyPools({
    groqPlan: GROQ_PLAN,
    geminiSlots: [{ value: "gemini-key-a", label: "test" }],
    fetchedAtMs: Date.now(),
  }, BATCH_A);
  resetCronLlmKeyPool(BATCH_A);
  assertEquals(isCronLlmKeyPoolHydrated(BATCH_A), false);
  const pool = resolveCronLlmKeyPool(BATCH_A);
  assertEquals(pool?.getStats("gemini").total, 1);
  assertEquals(isCronLlmKeyPoolHydrated(BATCH_A), true);
  clearCronBatchLlmKeyPools(BATCH_A);
});

Deno.test("getCronLlmKeyPool rejects wrong batchId", () => {
  clearCronBatchLlmKeyPools();
  publishCronBatchLlmKeyPools({
    groqPlan: GROQ_PLAN,
    geminiSlots: [{ value: "gemini-key-a", label: "test" }],
    fetchedAtMs: Date.now(),
  }, BATCH_A);
  assertThrows(
    () => getCronLlmKeyPool(BATCH_B),
    Error,
    "not ready for batch",
  );
  clearCronBatchLlmKeyPools(BATCH_A);
});
