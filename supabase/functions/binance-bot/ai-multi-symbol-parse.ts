// @ts-nocheck
import type { AiAnalysis } from "./types.ts";
import { normalizeAiResponse } from "./ai-normalize-model-response.ts";
import { normalizeSymbol, safeJsonParseFromText } from "./utils.ts";

export const MULTI_SYMBOL_BATCH_INSTRUCTION = [
  "MULTI_SYMBOL_BATCH: user JSON is {symbols:[{s,d},...]} — analyze each d independently.",
  "Return one raw minified JSON object: top-level keys = exact symbol strings (BTCUSDT).",
  "No markdown, fences, newlines, or spaces outside JSON string values.",
  "Per-symbol value keys only: a,al,ts,ms,vs,os,p (same as single-scan). Example value: {\"a\":\"BUY\",\"al\":1,\"ts\":70,\"ms\":65,\"vs\":60,\"os\":55,\"p\":\"tip\"}.",
  "BUY may add gv=APPROVE|REJECT, gr=short reason. No wrapper keys like results/data.",
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
