// @ts-nocheck
import type { AiAnalysis } from "./types.ts";

/** Gemini Tier-2 `structuralReasoning` for Groq Tier-3 gatekeeper. */
export function buildGeminiStructuralSummary(ai: AiAnalysis): string {
  const structural = String(ai.structural_reasoning ?? "").trim();
  if (structural) return structural.slice(0, 500);
  const reason = String(ai.reason ?? "").trim();
  if (reason) return reason.slice(0, 500);
  return `isSetupValid=${Boolean(ai.is_setup_valid)} action=${String(ai.action ?? "HOLD")}`;
}
