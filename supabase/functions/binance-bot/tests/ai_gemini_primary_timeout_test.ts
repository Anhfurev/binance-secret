import { assertEquals } from "jsr:@std/assert";
import {
  readGeminiPrimaryMatrixTimeoutMs,
  resolveGeminiRequestCapMs,
} from "../ai-models.ts";
import { isAbortOrTimeoutError } from "../ai-gemini-timeout.ts";

Deno.test("readGeminiPrimaryMatrixTimeoutMs defaults to 6000", () => {
  const prev = Deno.env.get("GEMINI_PRIMARY_MATRIX_TIMEOUT_MS");
  try {
    Deno.env.delete("GEMINI_PRIMARY_MATRIX_TIMEOUT_MS");
    assertEquals(readGeminiPrimaryMatrixTimeoutMs(), 6000);
    Deno.env.set("GEMINI_PRIMARY_MATRIX_TIMEOUT_MS", "5500");
    assertEquals(readGeminiPrimaryMatrixTimeoutMs(), 5500);
  } finally {
    if (prev === undefined) Deno.env.delete("GEMINI_PRIMARY_MATRIX_TIMEOUT_MS");
    else Deno.env.set("GEMINI_PRIMARY_MATRIX_TIMEOUT_MS", prev);
  }
});

Deno.test("resolveGeminiRequestCapMs applies matrix primary ceiling", () => {
  const prevEnv = Deno.env.get("GEMINI_REQUEST_TIMEOUT_MS");
  const prevMatrix = Deno.env.get("GEMINI_PRIMARY_MATRIX_TIMEOUT_MS");
  try {
    Deno.env.set("GEMINI_REQUEST_TIMEOUT_MS", "12000");
    Deno.env.set("GEMINI_PRIMARY_MATRIX_TIMEOUT_MS", "6000");
    assertEquals(
      resolveGeminiRequestCapMs({ dbHardTimeoutMs: 5000, primaryMatrixTimeoutMs: 6000 }),
      5000,
    );
    assertEquals(resolveGeminiRequestCapMs({ primaryMatrixTimeoutMs: 6000 }), 6000);
  } finally {
    if (prevEnv === undefined) Deno.env.delete("GEMINI_REQUEST_TIMEOUT_MS");
    else Deno.env.set("GEMINI_REQUEST_TIMEOUT_MS", prevEnv);
    if (prevMatrix === undefined) Deno.env.delete("GEMINI_PRIMARY_MATRIX_TIMEOUT_MS");
    else Deno.env.set("GEMINI_PRIMARY_MATRIX_TIMEOUT_MS", prevMatrix);
  }
});

Deno.test("isAbortOrTimeoutError matches Signal timed out", () => {
  assertEquals(isAbortOrTimeoutError(new DOMException("Signal timed out.", "TimeoutError")), true);
  assertEquals(isAbortOrTimeoutError(new Error("Gemini request timed out")), true);
});
