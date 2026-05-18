// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import { APIKeyManager } from "../api-key-manager.ts";
import { withLlmKeyCheckout } from "../llm-key-checkout.ts";
import { shouldSkipLlmKeyForRotation } from "../llm-key-rotation-guard.ts";
import {
  resetCronLlmKeyPool,
  setCronLlmKeyPoolForTest,
} from "../llm-key-pool.ts";

const DB_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

Deno.test("rotation guard: triple-guard skip does not use inflight registry", () => {
  assertEquals(
    shouldSkipLlmKeyForRotation({
      preferredKeyId: "groq_veto:0",
      dbRowId: DB_UUID,
      slotMeta: {
        dbRowId: DB_UUID,
        status: "blocked",
        errorCount: 0,
      },
      providerLabel: "Groq test",
    }),
    true,
  );
});

Deno.test("checkout wrapper: second parallel lane waits until checkin", async () => {
  const pool = new APIKeyManager();
  pool.registerKeys([
    { id: "groq_veto:0", provider: "groq", secret: "sk-parallel", dbRowId: DB_UUID },
  ]);
  setCronLlmKeyPoolForTest(pool);

  const first = await withLlmKeyCheckout(
    {
      provider: "groq",
      preferredKeyId: "groq_veto:0",
      dbRowId: DB_UUID,
      providerLabel: "Groq lane A",
      timeoutMs: 500,
    },
    async () => {
      const second = await withLlmKeyCheckout(
        {
          provider: "groq",
          preferredKeyId: "groq_veto:0",
          dbRowId: DB_UUID,
          providerLabel: "Groq lane B",
          timeoutMs: 200,
        },
        async () => "should-not-run",
      );
      assertEquals(second, null);
      return "ok";
    },
  );
  assertEquals(first, "ok");
  resetCronLlmKeyPool("test-batch");
});
