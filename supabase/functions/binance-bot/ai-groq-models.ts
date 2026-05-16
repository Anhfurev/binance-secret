// @ts-nocheck
/**
 * Scan path (multi-symbol batch + per-symbol `groqAnalyze`): **8B** default — much higher
 * free-tier daily budget than 70B. Override with `GROQ_SCAN_MODEL` / `GROQ_MODEL`.
 * BUY **veto** / trap uses `resolveGroqTrapModel` → **70B** by default (`DEFAULT_GROQ_EXECUTION_MODEL_ID`).
 */
export const DEFAULT_GROQ_SCAN_MODEL = "llama-3.1-8b-instant";

export const DEFAULT_GROQ_LEGACY_MODEL = "llama-3.1-8b-instant";

/** Trap / veto (live BUY review) — keep 70B unless `GROQ_MODEL` or `GROQ_EXECUTION_MODEL` overrides. */
export const DEFAULT_GROQ_EXECUTION_MODEL_ID = "llama-3.3-70b-versatile";

export function resolveGroqScanModel(): string {
  const scan = (Deno.env.get("GROQ_SCAN_MODEL") ?? "").trim();
  if (scan) return scan;
  const legacy = (Deno.env.get("GROQ_MODEL") ?? "").trim();
  if (legacy) return legacy;
  return DEFAULT_GROQ_SCAN_MODEL;
}

/** True when BUY veto may use a different (larger) model than the scan path — disables high-conviction fast-skip. */
export function isGroqTieredTrapConfigured(): boolean {
  if ((Deno.env.get("GROQ_EXECUTION_MODEL") ?? "").trim()) return true;
  return !(Deno.env.get("GROQ_MODEL") ?? "").trim();
}

export function resolveGroqExecutionMinConfidence(): number {
  const raw = Number(Deno.env.get("GROQ_EXECUTION_MIN_CONFIDENCE") ?? "90");
  if (!Number.isFinite(raw)) return 90;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

/**
 * BUY trap / veto model: prefer **`GROQ_EXECUTION_MODEL`** or **`DEFAULT_GROQ_EXECUTION_MODEL_ID` (70B)** —
 * not the lightweight scan model. `GROQ_MODEL` pins one id for both scan+trap (legacy).
 */
export function resolveGroqTrapModel(_scannerConfidence: number): string {
  const execExplicit = (Deno.env.get("GROQ_EXECUTION_MODEL") ?? "").trim();
  const legacy = (Deno.env.get("GROQ_MODEL") ?? "").trim();
  if (legacy) return legacy;
  if (execExplicit) return execExplicit;
  return DEFAULT_GROQ_EXECUTION_MODEL_ID;
}
