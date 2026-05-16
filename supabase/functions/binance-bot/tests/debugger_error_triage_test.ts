import { assertEquals } from "jsr:@std/assert";
import {
  isResolvedOperationalError,
  readGeminiRotationPerKey2hBudget,
  readGeminiRotationWarnThreshold,
  readGroqRotationPerKey2hBudget,
  readGroqRotationWarnThreshold,
  summarizeRecentErrors,
} from "../debugger-error-triage.ts";

Deno.test("isResolvedOperationalError ignores fixed paper scenario stub errors", () => {
  assertEquals(
    isResolvedOperationalError("buildPaperScenarioAiStub is not defined"),
    true,
  );
  assertEquals(
    isResolvedOperationalError("withLlmConcurrency is not defined"),
    true,
  );
  assertEquals(isResolvedOperationalError("symbol_cycle_failed"), false);
});

Deno.test("isResolvedOperationalError treats gtWithTolerance cycle bug as resolved after deploy", () => {
  assertEquals(isResolvedOperationalError("gtWithTolerance is not defined"), true);
  assertEquals(
    isResolvedOperationalError(`ReferenceError: Cannot access 'isPaperTrading' before initialization`),
    true,
  );
});

Deno.test("summarizeRecentErrors treats resolved detail as non-actionable", async () => {
  const supabase = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                gte() {
                  return {
                    order() {
                      return {
                        limit: async () => ({
                          data: [{
                            message: "safe_execute_caught:ai_verdict_BTCUSDT",
                            meta: { detail: "withLlmConcurrency is not defined" },
                          }],
                          error: null,
                        }),
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const summary = await summarizeRecentErrors({
    supabase: supabase as never,
    sinceIso: "2026-01-01T00:00:00.000Z",
  });
  assertEquals(summary.actionable, 0);
  assertEquals(summary.resolved, 1);
});

Deno.test("readGroqRotationWarnThreshold defaults to 40", () => {
  Deno.env.delete("DEBUGGER_GROQ_ROTATION_WARN_THRESHOLD");
  assertEquals(readGroqRotationWarnThreshold(), 40);
});

Deno.test("readGroqRotationPerKey2hBudget defaults to 120", () => {
  Deno.env.delete("DEBUGGER_GROQ_PER_KEY_2H_BUDGET");
  assertEquals(readGroqRotationPerKey2hBudget(), 120);
});

Deno.test("readGeminiRotationPerKey2hBudget defaults to 120", () => {
  Deno.env.delete("DEBUGGER_GEMINI_PER_KEY_2H_BUDGET");
  assertEquals(readGeminiRotationPerKey2hBudget(), 120);
});

Deno.test("readGeminiRotationWarnThreshold defaults to 40", () => {
  Deno.env.delete("DEBUGGER_GEMINI_ROTATION_WARN_THRESHOLD");
  assertEquals(readGeminiRotationWarnThreshold(), 40);
});
