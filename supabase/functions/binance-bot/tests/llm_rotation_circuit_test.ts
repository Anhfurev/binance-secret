// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import {
  shouldSkipLlmDbSlotTripleGuard,
  tripleGuardSkipReason,
} from "../llm-key-slot-gate.ts";
import {
  canStartRotationHttpAttempt,
  createSymbolRotationBudget,
  consumeRotationFailureAttempt,
  markRotationHardAbort,
} from "../llm-symbol-rotation-budget.ts";

Deno.test("triple-guard skips blocked, cooldown, and error_count cap", () => {
  assertEquals(
    shouldSkipLlmDbSlotTripleGuard({ dbRowId: "a", status: "blocked", errorCount: 0 }),
    true,
  );
  assertEquals(
    shouldSkipLlmDbSlotTripleGuard({ dbRowId: "b", status: "cooldown", errorCount: 0 }),
    true,
  );
  const prev = Deno.env.get("LLM_API_KEY_MAX_ERROR_COUNT");
  Deno.env.set("LLM_API_KEY_MAX_ERROR_COUNT", "2");
  try {
    assertEquals(
      shouldSkipLlmDbSlotTripleGuard({
        dbRowId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        status: "active",
        errorCount: 2,
      }),
      true,
    );
    assertEquals(tripleGuardSkipReason({ dbRowId: "x", status: "blocked" }), "status=blocked");
  } finally {
    if (prev === undefined) Deno.env.delete("LLM_API_KEY_MAX_ERROR_COUNT");
    else Deno.env.set("LLM_API_KEY_MAX_ERROR_COUNT", prev);
  }
});

Deno.test("symbol rotation budget stops after max failures", () => {
  const prev = Deno.env.get("LLM_SYMBOL_ROTATION_ATTEMPTS_MAX");
  Deno.env.set("LLM_SYMBOL_ROTATION_ATTEMPTS_MAX", "3");
  try {
    const b = createSymbolRotationBudget("BTCUSDT", "groq_scan");
    assertEquals(b.maxAttempts, 3);
    assertEquals(canStartRotationHttpAttempt(b), true);
    consumeRotationFailureAttempt(b);
    consumeRotationFailureAttempt(b);
    consumeRotationFailureAttempt(b);
    assertEquals(canStartRotationHttpAttempt(b), false);
    markRotationHardAbort(b);
    assertEquals(canStartRotationHttpAttempt(b), false);
  } finally {
    if (prev === undefined) Deno.env.delete("LLM_SYMBOL_ROTATION_ATTEMPTS_MAX");
    else Deno.env.set("LLM_SYMBOL_ROTATION_ATTEMPTS_MAX", prev);
  }
});
