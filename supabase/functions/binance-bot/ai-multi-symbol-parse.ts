// @ts-nocheck
import type { AiAnalysis } from "./types.ts";
import { normalizeAiResponse } from "./ai-normalize-model-response.ts";
import { normalizeSymbol, safeJsonParseFromText } from "./utils.ts";

export const MULTI_SYMBOL_BATCH_INSTRUCTION = [
  "MULTI_SYMBOL_BATCH: You are evaluating an array of multiple crypto assets at once.",
  "The user JSON has shape { symbols: [ { symbol, DATA }, ... ] } where each DATA is the usual single-symbol payload (tuples, RSI, trend_htf, etc.).",
  "Analyze each asset independently. Return ONE JSON object: top-level keys MUST be exactly each symbol string (e.g. BTCUSDT, SOLUSDT, PEPEUSDT).",
  "Each value MUST include: trend_score, momentum_score, volume_score, order_book_score, trend_alignment, action, pro_tip (≤12 words, JSON only).",
  "When action is BUY for a symbol, also set risk_review_verdict to APPROVE or REJECT and risk_review_reason (short) so trap review can stay inline.",
  "Do not wrap per-symbol results inside a generic key like \"response\" or \"data\" unless that object is the only top-level key and its children are the symbols.",
].join(" ");

export function extractBraceJson(raw: string): string {
  const brace = String(raw)
    .trim()
    .match(/\{[\s\S]*\}/);
  return brace ? brace[0].trim() : String(raw).trim();
}

/** Unwrap mistaken nesting: { results: { BTCUSDT: {...} } } or lone wrapper key. */
export function coercePerSymbolMap(
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  const unwrapKeys = ["results", "assets", "analyses", "bySymbol", "symbols_out"];
  for (const k of unwrapKeys) {
    const v = parsed[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  }
  if (
    Object.keys(parsed).length === 1 &&
    parsed["response"] &&
    typeof parsed["response"] === "object" &&
    !Array.isArray(parsed["response"])
  ) {
    return parsed["response"] as Record<string, unknown>;
  }
  return parsed;
}

export function parseMultiSymbolLlmContentToMap(
  content: string,
  items: Array<{ symbol: string; data: unknown }>,
): Map<string, AiAnalysis> {
  const parsed = safeJsonParseFromText(extractBraceJson(content)) as Record<
    string,
    unknown
  >;
  const flat = coercePerSymbolMap(parsed);
  const out = new Map<string, AiAnalysis>();
  for (const it of items) {
    const sym = normalizeSymbol(it.symbol, it.symbol);
    const inner =
      flat[sym] ??
      flat[it.symbol] ??
      flat[String(it.symbol).toUpperCase()];
    if (!inner || typeof inner !== "object") continue;
    try {
      out.set(sym, normalizeAiResponse(JSON.stringify(inner)));
    } catch {
      /* skip malformed slot */
    }
  }
  return out;
}
