// @ts-nocheck
/** Expand minified Gemini JSON keys into canonical normalizeAiResponse shape. */

function clampScore(n: unknown): number | undefined {
  const v = Number(n);
  if (!Number.isFinite(v)) return undefined;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function expandGeminiOutputKeys(
  parsed: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!parsed || typeof parsed !== "object") return {};
  if ("action" in parsed || "trend_score" in parsed) return parsed;
  const al = parsed.al ?? parsed.ta;
  const ultraC = clampScore(parsed.c ?? parsed.confidence);
  if (ultraC != null && parsed.ts == null && parsed.ms == null) {
    return {
      action: parsed.a ?? parsed.action,
      trend_alignment: al === 1 || al === true || al === "1",
      trend_score: ultraC,
      momentum_score: ultraC,
      volume_score: ultraC,
      order_book_score: ultraC,
      ai_confidence_override: ultraC,
      pro_tip: parsed.p ?? parsed.pro_tip,
    };
  }
  return {
    action: parsed.a ?? parsed.action,
    trend_alignment: al === 1 || al === true || al === "1",
    trend_score: parsed.ts ?? parsed.trend_score,
    momentum_score: parsed.ms ?? parsed.momentum_score,
    volume_score: parsed.vs ?? parsed.volume_score,
    order_book_score: parsed.os ?? parsed.order_book_score,
    pro_tip: parsed.p ?? parsed.pro_tip,
    groq_verdict: parsed.gv ?? parsed.groq_verdict,
    groq_reason: parsed.gr ?? parsed.groq_reason,
  };
}

export function expandCascadeGeminiKeys(
  parsed: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!parsed || typeof parsed !== "object") return {};
  if ("isSetupValid" in parsed) return parsed;
  return {
    isSetupValid: parsed.v === 1 || parsed.v === true || parsed.isSetupValid === true,
    structuralReasoning: String(parsed.r ?? parsed.structuralReasoning ?? ""),
  };
}
