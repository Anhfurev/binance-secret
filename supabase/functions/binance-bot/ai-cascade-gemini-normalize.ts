// @ts-nocheck
import type { AiAnalysis } from "./types.ts";
import { readTier2GeminiMinConfidence } from "./ai-cascade-config.ts";
import { sanitizeStructuralReasoningForPayload } from "./ai-cascade-text-sanitize.ts";
import { expandCascadeGeminiKeys } from "./gemini-output-expand.ts";
import { safeJsonParseFromText } from "./utils.ts";

export function normalizeCascadeGeminiResponse(text: string): AiAnalysis {
  const raw = safeJsonParseFromText(sanitizeJson(text)) as Record<string, unknown> | null;
  const parsed = expandCascadeGeminiKeys(raw);
  const valid = Boolean(parsed?.isSetupValid);
  const reasoning = sanitizeStructuralReasoningForPayload(
    String(parsed?.structuralReasoning ?? parsed?.reasoning ?? ""),
    500,
  );
  const floor = readTier2GeminiMinConfidence();
  const confidence = valid
    ? Math.max(floor, 72)
    : Math.min(40, floor - 1);
  return {
    ai_confidence: confidence,
    trend: valid ? "bullish" : "neutral",
    trend_alignment: valid,
    action: valid ? "BUY" : "HOLD",
    trend_score: valid ? 70 : 35,
    momentum_score: valid ? 68 : 30,
    volume_score: valid ? 65 : 28,
    order_book_score: 50,
    reason: reasoning || (valid ? "cascade_setup_valid" : "cascade_setup_invalid"),
    structural_reasoning: reasoning,
    is_setup_valid: valid,
    raw_ai_response: parsed,
  };
}

function sanitizeJson(raw: string): string {
  let s = String(raw ?? "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const brace = s.match(/\{[\s\S]*\}/);
  if (!brace) return s;
  try {
    return JSON.stringify(JSON.parse(brace[0]));
  } catch {
    return brace[0].replace(/\s+/g, " ").trim();
  }
}
