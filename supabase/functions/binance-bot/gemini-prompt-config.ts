// @ts-nocheck
/** Minified Gemini system prompts + output schema (TTFT + token savings). */

import { readAiLlmIncludeScoringRubric } from "./ai-payload-slim.ts";

/** Canonical scan shape — compact JSON, no spaces (model must match byte-for-byte style). */
export const GEMINI_SCAN_OUTPUT_SCHEMA =
  '{"a":"BUY|SELL|HOLD","al":0|1,"ts":n,"ms":n,"vs":n,"os":n,"p":"≤12w"}';

/** Ultra-min fallback schema when `GEMINI_SCAN_ULTRA_MIN=1`. */
export const GEMINI_SCAN_ULTRA_MIN_SCHEMA = '{"a":"BUY|SELL|HOLD","c":n}';

const OUTPUT_RULES = [
  "OUTPUT: exactly one raw JSON object.",
  "Forbidden: markdown, code fences, ```json blocks, backticks, newlines, spaces outside JSON string values, prose before/after JSON.",
  "Format like JSON.stringify output: no pretty-print, no line breaks.",
].join(" ");

export const GEMINI_SCAN_SYSTEM_MINIFIED = [
  "Quant REST scanner. Deterministic signal only.",
  OUTPUT_RULES,
  `Keys: a,al,ts,ms,vs,os,p. Schema: ${GEMINI_SCAN_OUTPUT_SCHEMA}.`,
  'Example: {"a":"BUY","al":1,"ts":72,"ms":68,"vs":55,"os":50,"p":"Tight stop"}',
  "a=BUY|SELL|HOLD. al=1 iff short TF agrees HTF. ts/ms/vs/os=0-100. p≤12 words risk tip.",
  "Never output confidence, reason, or long keys; server weights ts,ms,vs,os.",
  "Input D:{...} tuples [t,o,h,l,c,v], reg, adx, atr, thtf. RANGING: volume vs avg1m; imb>2.5 lifts os.",
  "Meme: liquidity-aware vs/os. thtf.ok=0 => a=HOLD.",
].join(" ");

export const GEMINI_SCAN_ULTRA_MIN_SYSTEM = [
  "Quant REST scanner. Deterministic signal only.",
  OUTPUT_RULES,
  `Keys: a,c only. Schema: ${GEMINI_SCAN_ULTRA_MIN_SCHEMA}.`,
  'Example: {"a":"BUY","c":85.5}',
  "a=BUY|SELL|HOLD. c=0-100 conviction. No other keys.",
].join(" ");

export const GEMINI_SCORING_RUBRIC_CACHED = [
  "Rubric: ts=HTF+1m; ms=RSI/MACD; vs=volume; os=imbalance.",
  "RANGING: mean-reversion; TRENDING: trend. BUY vs 1h EMA200 capped server-side.",
].join(" ");

export const GEMINI_CASCADE_OUTPUT_SCHEMA = '{"v":0|1,"r":"≤20w"}';

export const GEMINI_CASCADE_SYSTEM_MINIFIED = [
  "Pullback validator. Deterministic.",
  OUTPUT_RULES,
  `Keys: v,r only. Schema: ${GEMINI_CASCADE_OUTPUT_SCHEMA}.`,
  'Example: {"v":1,"r":"Wick held support"}',
  "v=1 iff healthy pullback + absorption on c5/c1h near S/R.",
].join(" ");

/** @deprecated alias — Groq + legacy imports */
export const AI_SYSTEM_REST_API = GEMINI_SCAN_SYSTEM_MINIFIED;

/** @deprecated cascade alias */
export const GEMINI_CASCADE_SCANNER_SYSTEM = GEMINI_CASCADE_SYSTEM_MINIFIED;

export function readGeminiScanUltraMinEnabled(): boolean {
  const raw = String(Deno.env.get("GEMINI_SCAN_ULTRA_MIN") ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function buildGeminiScanSystemForCache(): string {
  const base = readGeminiScanUltraMinEnabled()
    ? GEMINI_SCAN_ULTRA_MIN_SYSTEM
    : GEMINI_SCAN_SYSTEM_MINIFIED;
  const parts = [base];
  if (readAiLlmIncludeScoringRubric() && !readGeminiScanUltraMinEnabled()) {
    parts.push(GEMINI_SCORING_RUBRIC_CACHED);
  }
  return parts.join("\n");
}

export function readGeminiUserDataPrefix(): string {
  return String(Deno.env.get("GEMINI_USER_PREFIX") ?? "D:").trim() || "D:";
}
