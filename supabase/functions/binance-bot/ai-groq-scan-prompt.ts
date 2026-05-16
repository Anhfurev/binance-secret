// @ts-nocheck
/** Short system text for Groq *scan* completions (saves TPM vs full `AI_SYSTEM_REST_API`). */

export const GROQ_SCAN_SYSTEM_MINIMAL = [
  "REST API: output exactly one raw JSON object — nothing before or after.",
  "Required: trend_score, momentum_score, volume_score, order_book_score (0-100), trend_alignment (boolean), action BUY|SELL|HOLD, pro_tip (≤12 words, no extra sentences).",
  "DATA uses OHLCV as [openTimeMs,o,h,l,c,v] tuples. No markdown, no URLs, no long prose.",
].join(" ");

export function readGroqScanMinimalSystemEnabled(): boolean {
  const raw = String(Deno.env.get("GROQ_SCAN_MINIMAL_SYSTEM") ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}
