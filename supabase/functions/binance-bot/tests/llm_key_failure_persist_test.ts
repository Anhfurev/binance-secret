// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import {
  clearLlmKeyFailurePersistLedger,
  hasLlmKeyFailureBeenPersisted,
  isValidLlmApiKeyRowId,
  markLlmKeyFailurePersisted,
} from "../llm-key-failure-persist.ts";
import {
  canPersistLlmKeyDbFailure,
  clearLlmKeyDbFailureBudget,
  consumeLlmKeyDbFailureBudget,
  isLlmDbFailureBudgetExhausted,
  readLlmDbCooldownMarksPerSymbol,
} from "../llm-key-failure-budget.ts";

const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

Deno.test("persist ledger dedupes same llm_api_keys row id", () => {
  clearLlmKeyFailurePersistLedger();
  assertEquals(isValidLlmApiKeyRowId(UUID), true);
  assertEquals(hasLlmKeyFailureBeenPersisted(UUID), false);
  markLlmKeyFailurePersisted(UUID);
  assertEquals(hasLlmKeyFailureBeenPersisted(UUID), true);
});

Deno.test("per-symbol DB failure budget caps marks", () => {
  clearLlmKeyDbFailureBudget();
  const prev = Deno.env.get("LLM_DB_COOLDOWN_MARKS_PER_SYMBOL");
  Deno.env.set("LLM_DB_COOLDOWN_MARKS_PER_SYMBOL", "2");
  try {
    assertEquals(readLlmDbCooldownMarksPerSymbol(), 2);
    assertEquals(canPersistLlmKeyDbFailure("BTCUSDT", "gemini"), true);
    consumeLlmKeyDbFailureBudget("BTCUSDT", "gemini");
    assertEquals(canPersistLlmKeyDbFailure("BTCUSDT", "gemini"), true);
    consumeLlmKeyDbFailureBudget("BTCUSDT", "gemini");
    assertEquals(isLlmDbFailureBudgetExhausted("BTCUSDT", "gemini"), true);
    assertEquals(canPersistLlmKeyDbFailure("BTCUSDT", "gemini"), false);
  } finally {
    if (prev === undefined) Deno.env.delete("LLM_DB_COOLDOWN_MARKS_PER_SYMBOL");
    else Deno.env.set("LLM_DB_COOLDOWN_MARKS_PER_SYMBOL", prev);
    clearLlmKeyDbFailureBudget();
  }
});
