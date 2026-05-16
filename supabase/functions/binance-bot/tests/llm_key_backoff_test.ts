import { assertEquals } from "jsr:@std/assert";
import {
  GEMINI_QUOTA_COOLDOWN_MS,
  isPermanentCredentialOrSuspension,
  readGeminiAuthKeyCooldownMs,
  readGeminiGeneric403CooldownMs,
  resolveLlmKeyFailureCooldownMs,
} from "../llm-key-backoff.ts";

Deno.test("resolveLlmKeyFailureCooldownMs uses long bench for suspended / permission denied", () => {
  const msg =
    `Gemini status 403: {"error":{"code":403,"message":"Permission denied: Consumer suspended","status":"PERMISSION_DENIED"}}`;
  assertEquals(isPermanentCredentialOrSuspension(msg), true);
  const ms = resolveLlmKeyFailureCooldownMs(msg);
  assertEquals(ms, readGeminiAuthKeyCooldownMs());
  assertEquals(ms! >= 24 * 60 * 60 * 1000, true);
});

Deno.test("resolveLlmKeyFailureCooldownMs uses short cooldown for 429 / quota", () => {
  assertEquals(resolveLlmKeyFailureCooldownMs("QUOTA_EXHAUSTED: x"), GEMINI_QUOTA_COOLDOWN_MS);
  assertEquals(resolveLlmKeyFailureCooldownMs("Gemini status 429"), GEMINI_QUOTA_COOLDOWN_MS);
});

Deno.test("resolveLlmKeyFailureCooldownMs uses medium cooldown for opaque 403", () => {
  assertEquals(resolveLlmKeyFailureCooldownMs("Gemini status 403: forbidden"), readGeminiGeneric403CooldownMs());
});

Deno.test("resolveLlmKeyFailureCooldownMs returns null for unrelated errors", () => {
  assertEquals(resolveLlmKeyFailureCooldownMs("network reset"), null);
});
