// @ts-nocheck
import type { AiAnalysis } from "./types.ts";
import { computeWeightedConfidence, truncateProTip } from "./ai-scoring.ts";
import { expandGeminiOutputKeys } from "./gemini-output-expand.ts";
import { safeJsonParseFromText, toNumber } from "./utils.ts";

export function normalizeAiResponse(text: string): AiAnalysis {
  const raw = safeJsonParseFromText(
    sanitizeModelTextForJson(String(text ?? "")),
  ) as Record<string, unknown> | null;
  const parsed = expandGeminiOutputKeys(raw) as Record<string, unknown>;
  const alignment = Boolean(parsed?.trend_alignment);
  const actionRaw = String(parsed?.action ?? "HOLD").toUpperCase();
  const action =
    actionRaw === "BUY" || actionRaw === "SELL" ? actionRaw : "HOLD";
  const trend =
    action === "BUY" ? "bullish" : action === "SELL" ? "bearish" : "neutral";
  const trend_score = clamp01to100(toNumber(parsed?.trend_score, 0));
  const momentum_score = clamp01to100(toNumber(parsed?.momentum_score, 0));
  const volume_score = clamp01to100(toNumber(parsed?.volume_score, 0));
  const order_book_score = clamp01to100(toNumber(parsed?.order_book_score, 0));
  const pro_tip = truncateProTip(String(parsed?.pro_tip ?? ""));

  const base: AiAnalysis = {
    ai_confidence: 0,
    trend,
    trend_alignment: alignment,
    action,
    trend_score,
    momentum_score,
    volume_score,
    order_book_score,
    pro_tip: pro_tip || undefined,
    raw_ai_response: parsed,
  };
  const verdictRaw = String(
    parsed?.groq_verdict ?? parsed?.risk_review_verdict ?? "",
  ).toUpperCase();
  if (
    verdictRaw === "APPROVE" ||
    verdictRaw === "REJECT" ||
    verdictRaw === "SKIPPED"
  ) {
    base.groq_verdict = verdictRaw as "APPROVE" | "REJECT" | "SKIPPED";
    const r = String(
      parsed?.groq_reason ?? parsed?.risk_review_reason ?? "",
    ).trim();
    if (r) base.groq_reason = r.slice(0, 500);
    base.raw_groq_veto_response = {
      verdict: verdictRaw,
      reason: base.groq_reason,
      inline_batch: true,
    };
  }
  const override = clamp01to100(
    Number((parsed as Record<string, unknown>)?.ai_confidence_override),
  );
  base.ai_confidence = override > 0 ? override : computeWeightedConfidence(base);
  return base;
}

function clamp01to100(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sanitizeModelTextForJson(rawText: string) {
  let s = String(rawText ?? "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const brace = s.match(/\{[\s\S]*\}/);
  if (!brace) return s;
  try {
    return JSON.stringify(JSON.parse(brace[0]));
  } catch {
    return brace[0].replace(/\s+/g, " ").trim();
  }
}
