// @ts-nocheck
/** Per-symbol LLM load balancing: even index → Groq primary, odd → Gemini primary. */

import { readPreemptiveLlmKeyRoutingEnabled } from "./llm-key-preemptive-route.ts";

export type MatrixLlmProvider = "groq" | "gemini";

export function readAiProviderMatrixEnabled(): boolean {
  const raw = String(Deno.env.get("AI_PROVIDER_MATRIX") ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

/** Index 0 BTC → Groq; 1 SOL → Gemini; 2 PEPE → Groq; … */
export function resolveMatrixPrimaryProvider(symbolIndex: number): MatrixLlmProvider {
  const idx = Math.max(0, Math.floor(symbolIndex));
  return idx % 2 === 0 ? "groq" : "gemini";
}

export function resolveMatrixFallbackProvider(symbolIndex: number): MatrixLlmProvider {
  return resolveMatrixPrimaryProvider(symbolIndex) === "groq" ? "gemini" : "groq";
}

function readSymbolGapBounds(): { defaultMs: number; minMs: number } {
  if (readAiProviderMatrixEnabled() && readPreemptiveLlmKeyRoutingEnabled()) {
    return { defaultMs: 400, minMs: 200 };
  }
  if (readAiProviderMatrixEnabled()) {
    return { defaultMs: 500, minMs: 200 };
  }
  return { defaultMs: 2500, minMs: 2500 };
}

/** Gap between serial cron symbol batches (`SYMBOL_MATRIX_GAP_MS` / `GEMINI_CRON_SYMBOL_GAP_MS`). */
export function readSymbolMatrixGapMs(): number {
  const { defaultMs, minMs } = readSymbolGapBounds();
  const raw = Number(
    Deno.env.get("SYMBOL_MATRIX_GAP_MS") ??
      Deno.env.get("GEMINI_CRON_SYMBOL_GAP_MS") ??
      String(defaultMs),
  );
  if (!Number.isFinite(raw)) return defaultMs;
  return Math.min(30_000, Math.max(minMs, Math.floor(raw)));
}

export function readCronSerialSymbolCyclesEnabled(): boolean {
  return readAiProviderMatrixEnabled() || readLegacySerialForGeminiQuota();
}

function readLegacySerialForGeminiQuota(): boolean {
  const skip = String(Deno.env.get("AI_SKIP_GEMINI") ?? "").trim().toLowerCase();
  const dis = String(Deno.env.get("GEMINI_DISABLED") ?? "").trim().toLowerCase();
  if (skip === "1" || skip === "true" || dis === "1" || dis === "true") return false;
  return true;
}
