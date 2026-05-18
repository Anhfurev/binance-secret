// @ts-nocheck
/** Strip control chars / cap length before Tier 3 JSON.stringify (quotes/newlines are escaped by JSON). */

const DEFAULT_STRUCTURAL_REASONING_MAX = 2000;

export function sanitizeStructuralReasoningForPayload(
  raw: string,
  maxLen = DEFAULT_STRUCTURAL_REASONING_MAX,
): string {
  let s = String(raw ?? "");
  s = s.replace(/\u0000/g, "");
  s = s.replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  s = s.replace(/\u2028|\u2029/g, " ");
  s = s.trim();
  if (!Number.isFinite(maxLen) || maxLen < 64) return s;
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

/** Verify object round-trips through JSON (Groq user message path). */
export function assertJsonSerializablePayload(payload: Record<string, unknown>): void {
  try {
    JSON.parse(JSON.stringify(payload));
  } catch (e) {
    throw new Error(
      `cascade_payload_not_json_serializable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
