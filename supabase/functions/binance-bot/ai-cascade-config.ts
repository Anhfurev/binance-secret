// @ts-nocheck
/** 3-tier cascade: math guard → Gemini scanner → Groq gatekeeper. */

export function readAiCascadePipelineEnabled(): boolean {
  const raw = String(Deno.env.get("AI_CASCADE_PIPELINE") ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

/** Tier 1: RSI must be at or below this to invoke any LLM (default 35 = genuinely oversold). */
export function readTier1OversoldRsiMax(): number {
  const raw = Number(Deno.env.get("TIER1_OVERSOLD_RSI_MAX") ?? "35");
  if (!Number.isFinite(raw)) return 35;
  return Math.min(50, Math.max(20, Math.floor(raw)));
}

/** Tier 2: minimum Gemini weighted confidence before Groq gatekeeper (default 65). */
export function readTier2GeminiMinConfidence(): number {
  const raw = Number(Deno.env.get("TIER2_GEMINI_MIN_CONFIDENCE") ?? "65");
  if (!Number.isFinite(raw)) return 65;
  return Math.min(95, Math.max(50, Math.floor(raw)));
}

/** Tier 3 + execution: Groq-confirmed BUY needs this confidence for full execution path (default 85). */
export function readGroqGatekeeperMinConfidence(): number {
  const raw = Number(Deno.env.get("GROQ_GATEKEEPER_MIN_CONFIDENCE") ?? "85");
  if (!Number.isFinite(raw)) return 85;
  return Math.min(100, Math.max(70, Math.floor(raw)));
}
