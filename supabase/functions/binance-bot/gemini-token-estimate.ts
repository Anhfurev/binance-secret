// @ts-nocheck
/** Fast token heuristics for Gemini context-cache eligibility (no tokenizer RPC). */

/** Gemini explicit cache minimum (API rejects below this). */
export const MIN_CACHE_TOKENS = 2048;

/** ~4 chars/token — conservative for JSON + English system prompts. */
export function approximateGeminiTokenCount(text: string): number {
  const t = String(text ?? "").trim();
  if (!t) return 0;
  return Math.ceil(t.length / 4);
}

export function isGeminiContextCacheEligible(
  systemInstruction: string,
  userText = "",
): boolean {
  const sys = approximateGeminiTokenCount(systemInstruction);
  const user = approximateGeminiTokenCount(userText);
  return sys + user >= MIN_CACHE_TOKENS;
}

export function isGeminiCachePayloadClientError(bodyOrMessage: string): boolean {
  const s = String(bodyOrMessage ?? "").toLowerCase();
  return s.includes("invalid_argument") ||
    s.includes("invalid argument") ||
    s.includes("cached content is too small") ||
    s.includes("min_total_token_count") ||
    s.includes("total_token_count=");
}
