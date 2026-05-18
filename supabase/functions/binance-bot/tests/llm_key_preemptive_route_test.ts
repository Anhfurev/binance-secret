import { assertEquals } from "jsr:@std/assert";
import {
  buildPreemptiveRotationOrder,
  buildQuotaRotationOrder,
  claimCronLlmLaneOffset,
  clearCronBatchLlmKeyPools,
  publishCronBatchLlmKeyPools,
  readPreemptiveLlmKeyRoutingEnabled,
  resolvePreemptiveKeyIndex,
  resolvePreemptiveKeyIndexForLane,
  shouldPreemptiveRouteForSymbolIndex,
} from "../llm-key-preemptive-route.ts";

Deno.test("resolvePreemptiveKeyIndex round-robins by symbol index", () => {
  assertEquals(resolvePreemptiveKeyIndex(0, 3), 0);
  assertEquals(resolvePreemptiveKeyIndex(1, 3), 1);
  assertEquals(resolvePreemptiveKeyIndex(2, 3), 2);
  assertEquals(resolvePreemptiveKeyIndex(3, 3), 0);
  assertEquals(resolvePreemptiveKeyIndex(5, 2), 1);
});

Deno.test("resolvePreemptiveKeyIndexForLane spreads parallel lanes", () => {
  clearCronBatchLlmKeyPools();
  publishCronBatchLlmKeyPools({
    groqPlan: {
      scanKeys: ["a", "b", "c"],
      vetoKeys: [],
      scanDbIds: [],
      vetoDbIds: [],
      scanDbErrorCounts: [],
      vetoDbErrorCounts: [],
      scanDbStatuses: [],
      vetoDbStatuses: [],
      scanDbCooldownUntils: [],
      vetoDbCooldownUntils: [],
      useDbHardTimeout: false,
      source: "env",
    },
    geminiSlots: [],
    fetchedAtMs: 0,
  }, "test-preemptive-batch");
  const salt0 = claimCronLlmLaneOffset();
  const salt1 = claimCronLlmLaneOffset();
  const a = resolvePreemptiveKeyIndexForLane(0, 5, salt0);
  const b = resolvePreemptiveKeyIndexForLane(0, 5, salt1);
  assertEquals(a, resolvePreemptiveKeyIndex(0 + salt0, 5));
  assertEquals(b, resolvePreemptiveKeyIndex(0 + salt1, 5));
  assertEquals(a !== b, true);
});

Deno.test("buildPreemptiveRotationOrder starts at preferred index", () => {
  assertEquals(buildPreemptiveRotationOrder(1, 3), [1, 2, 0]);
  assertEquals(buildPreemptiveRotationOrder(2, 3), [2, 0, 1]);
});

Deno.test("buildQuotaRotationOrder legacy fail-then-rotate", () => {
  assertEquals(buildQuotaRotationOrder(0, 3), [1, 2, 0]);
  assertEquals(buildQuotaRotationOrder(2, 3), [0, 1, 2]);
});

Deno.test("shouldPreemptiveRouteForSymbolIndex requires matrix + env", () => {
  const prevMatrix = Deno.env.get("AI_PROVIDER_MATRIX");
  const prevPreempt = Deno.env.get("LLM_PREEMPTIVE_KEY_ROUTING");
  const prevCascade = Deno.env.get("AI_CASCADE_PIPELINE");
  try {
    Deno.env.set("AI_CASCADE_PIPELINE", "0");
    Deno.env.set("AI_PROVIDER_MATRIX", "1");
    Deno.env.set("LLM_PREEMPTIVE_KEY_ROUTING", "1");
    assertEquals(shouldPreemptiveRouteForSymbolIndex(0), true);
    assertEquals(shouldPreemptiveRouteForSymbolIndex(undefined), false);
    Deno.env.set("LLM_PREEMPTIVE_KEY_ROUTING", "0");
    assertEquals(shouldPreemptiveRouteForSymbolIndex(0), false);
  } finally {
    if (prevMatrix === undefined) Deno.env.delete("AI_PROVIDER_MATRIX");
    else Deno.env.set("AI_PROVIDER_MATRIX", prevMatrix);
    if (prevPreempt === undefined) Deno.env.delete("LLM_PREEMPTIVE_KEY_ROUTING");
    else Deno.env.set("LLM_PREEMPTIVE_KEY_ROUTING", prevPreempt);
    if (prevCascade === undefined) Deno.env.delete("AI_CASCADE_PIPELINE");
    else Deno.env.set("AI_CASCADE_PIPELINE", prevCascade);
  }
});

Deno.test("readPreemptiveLlmKeyRoutingEnabled defaults on", () => {
  const prev = Deno.env.get("LLM_PREEMPTIVE_KEY_ROUTING");
  try {
    Deno.env.delete("LLM_PREEMPTIVE_KEY_ROUTING");
    assertEquals(readPreemptiveLlmKeyRoutingEnabled(), true);
  } finally {
    if (prev === undefined) Deno.env.delete("LLM_PREEMPTIVE_KEY_ROUTING");
    else Deno.env.set("LLM_PREEMPTIVE_KEY_ROUTING", prev);
  }
});
