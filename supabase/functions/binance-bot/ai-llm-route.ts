// @ts-nocheck
/** Env-driven order / Gemini participation for `getAiAnalysis`. */

function truthyEnv(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** When true, `getAiAnalysis` never calls Gemini (avoids quota cooldown noise when Groq-only). */
export function readAiSkipGemini(): boolean {
  const a = String(Deno.env.get("AI_SKIP_GEMINI") ?? "").trim();
  const b = String(Deno.env.get("GEMINI_DISABLED") ?? "").trim();
  return truthyEnv(a) || truthyEnv(b);
}

/** When true, try Groq scan before Gemini; Gemini still runs after if Groq returns null (unless skip). */
export function readAiPrimaryLlmIsGroq(): boolean {
  const raw = String(Deno.env.get("AI_PRIMARY_LLM") ?? "").trim().toLowerCase();
  return raw === "groq";
}
