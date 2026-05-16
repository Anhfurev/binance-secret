// @ts-nocheck
import {
  isPermanentCredentialOrSuspension,
  isSoftQuotaOrRateLimit,
} from "./llm-key-backoff.ts";

/**
 * After 429 / rate-limit style failures on Groq scan or veto keys.
 * Supabase secret: `GROQ_COOLDOWN_DURATION_SEC=60` (default 60 when unset).
 * Set `0` to disable rotation delay (not recommended — risks hammering Groq).
 */
export function readGroqSoftFailureCooldownMs(): number {
  const raw = String(Deno.env.get("GROQ_COOLDOWN_DURATION_SEC") ?? "").trim();
  if (!raw.length) return 60_000;
  const sec = Number(raw);
  if (!Number.isFinite(sec)) return 60_000;
  if (sec <= 0) return 0;
  return Math.min(3600 * 1000, Math.floor(sec * 1000));
}

/** Suspended / permission-denied style messages — keep off the key longer than a soft glitch. */
function readGroqPermanentFailureCooldownMs(): number {
  const raw = String(Deno.env.get("GROQ_PERMANENT_FAILURE_COOLDOWN_SEC") ?? "").trim();
  const sec = Number(raw);
  if (!Number.isFinite(sec) || sec < 60) return 30 * 60 * 1000;
  return Math.min(48 * 60 * 60 * 1000, Math.floor(sec * 1000));
}

/**
 * Per-Groq-key DB cooldown after a failed scan/veto call (unlike Gemini paths in `resolveLlmKeyFailureCooldownMs`).
 */
export function resolveGroqKeyFailureCooldownMs(message: string): number | null {
  const u = String(message ?? "").toUpperCase();
  if (isPermanentCredentialOrSuspension(u)) {
    return readGroqPermanentFailureCooldownMs();
  }
  if (isSoftQuotaOrRateLimit(u)) return readGroqSoftFailureCooldownMs();
  if (u.includes("STATUS 401") || u.includes(" 401") || u.includes(": 401")) {
    return readGroqSoftFailureCooldownMs();
  }
  if (u.includes("STATUS 403") || u.includes(" 403") || u.includes(": 403")) {
    return readGroqSoftFailureCooldownMs();
  }
  return null;
}
