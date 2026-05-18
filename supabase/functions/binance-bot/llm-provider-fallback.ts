// @ts-nocheck
import { mergeLlmAbortSignal } from "./ai-models.ts";

/** Deep-clone LLM JSON payload so provider A errors never contaminate provider B body. */
export function cloneLlmAnalyzePayload(data: unknown): unknown {
  if (data == null) return data;
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return data;
  }
}

/**
 * After primary-provider 429/quota, do not reuse an aborted composite signal on fallback HTTP.
 * Keeps cycle abort when still active; otherwise fresh timeout-only signal.
 */
export function freshCrossProviderAbortSignal(
  cycleSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const ms = Math.min(Math.max(timeoutMs, 3000), 120_000);
  if (cycleSignal?.aborted) {
    return AbortSignal.timeout(ms);
  }
  return mergeLlmAbortSignal(cycleSignal, ms);
}

export function readCrossProviderFallbackTimeoutMs(provider: "gemini" | "groq"): number {
  const key = provider === "gemini"
    ? "GEMINI_REQUEST_TIMEOUT_MS"
    : "GROQ_REQUEST_TIMEOUT_MS";
  const n = Number(Deno.env.get(key) ?? "");
  if (!Number.isFinite(n) || n < 3000) {
    return provider === "gemini" ? 12_000 : 10_000;
  }
  return Math.min(120_000, Math.floor(n));
}
