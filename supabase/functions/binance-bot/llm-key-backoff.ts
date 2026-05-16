/** Short cooldown when a key hits rate limit / soft quota (rotate to sibling key). */
export const GEMINI_QUOTA_COOLDOWN_MS = 10 * 60 * 1000;

export function readGeminiAuthKeyCooldownMs(): number {
  const raw = String(Deno.env.get("GEMINI_AUTH_KEY_COOLDOWN_MS") ?? "").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 60_000) return 24 * 60 * 60 * 1000;
  return Math.min(7 * 24 * 60 * 60 * 1000, Math.floor(n));
}

/** Generic HTTP 403 without clear suspension text (unknown policy block). */
export function readGeminiGeneric403CooldownMs(): number {
  const raw = String(Deno.env.get("GEMINI_GENERIC_403_COOLDOWN_MS") ?? "").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 60_000) return 60 * 60 * 1000;
  return Math.min(48 * 60 * 60 * 1000, Math.floor(n));
}

/** Gemini key suspended / permission denied — do not rotate keys or apply per-key backoff. */
export class GeminiTerminalAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiTerminalAuthError";
  }
}

export function isGeminiTerminalAuthError(error: unknown): boolean {
  return error instanceof GeminiTerminalAuthError ||
    (error instanceof Error && error.name === "GeminiTerminalAuthError");
}

export function isPermanentCredentialOrSuspension(msg: string): boolean {
  const u = String(msg ?? "").toUpperCase();
  return (
    u.includes("PERMISSION_DENIED") ||
    u.includes("HAS BEEN SUSPENDED") ||
    u.includes("CONSUMER_SUS") ||
    u.includes("CONSUMER_SUSPENDED") ||
    u.includes("API_KEY_INVALID") ||
    u.includes("API_KEY_NOT_VALID") ||
    (u.includes("REQUEST_DENIED") && u.includes("CONSUMER"))
  );
}

export function isGeminiKeyAvailable(
  key: string,
  cooldowns: Record<string, number>,
  nowMs = Date.now(),
): boolean {
  return Number(cooldowns[key] ?? 0) <= nowMs;
}

export function hasAnyAvailableGeminiKey(
  keys: string[],
  cooldowns: Record<string, number>,
  nowMs = Date.now(),
): boolean {
  return keys.some((k) => isGeminiKeyAvailable(k, cooldowns, nowMs));
}

export function isSoftQuotaOrRateLimit(msg: string): boolean {
  const u = String(msg ?? "").toUpperCase();
  return (
    u.includes("QUOTA_EXHAUSTED") ||
    u.includes("RESOURCE_EXHAUSTED") ||
    u.includes("RATE LIMIT") ||
    u.includes("RATE_LIMIT") ||
    u.includes("STATUS 429") ||
    u.includes(" 429") ||
    u.includes(": 429")
  );
}

/**
 * Per-key cooldown after a failed LLM call. `null` = do not apply key rotation backoff
 * (caller may treat as hard failure / break).
 */
export function resolveLlmKeyFailureCooldownMs(message: string): number | null {
  const u = String(message ?? "").toUpperCase();
  // Terminal auth: long bench via caller (`readGeminiAuthKeyCooldownMs`), not short TPM cooldown.
  if (isPermanentCredentialOrSuspension(u)) return readGeminiAuthKeyCooldownMs();
  if (isSoftQuotaOrRateLimit(u)) return GEMINI_QUOTA_COOLDOWN_MS;
  if (u.includes("STATUS 401") || u.includes(" 401") || u.includes(": 401")) {
    return readGeminiAuthKeyCooldownMs();
  }
  if (u.includes("STATUS 403") || u.includes(" 403") || u.includes(": 403")) {
    return readGeminiGeneric403CooldownMs();
  }
  return null;
}

/** @deprecated use resolveLlmKeyFailureCooldownMs(msg) != null */
export function isLlmKeyBackoffMessage(message: string): boolean {
  return resolveLlmKeyFailureCooldownMs(message) != null;
}
