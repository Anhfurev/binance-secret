// @ts-nocheck
/**
 * One Gemini completion per cron for all symbols when Gemini is primary (RPM). Same map as Groq batch.
 *
 * - **Default:** on when `AI_PRIMARY_LLM` is not `groq`. Set `GEMINI_MULTI_SYMBOL_BATCH=0` to disable.
 * - **Force on:** `GEMINI_MULTI_SYMBOL_BATCH=1` even when Groq is primary (advanced; cron still prefers primary).
 */
import type { AiAnalysis } from "./types.ts";
import { envLlmTimeoutMs, mergeLlmAbortSignal } from "./ai-models.ts";
import { emitGeminiTelemetry } from "./ai-llm-telemetry.ts";
import { readAiPrimaryLlmIsGroq } from "./ai-llm-route.ts";
import { buildGeminiScanSystemForCache } from "./gemini-prompt-config.ts";
import { readGeminiModelId } from "./gemini-context-cache.ts";
import { extractGeminiText, geminiGenerateContent } from "./gemini-http.ts";
import { buildMinifiedGeminiPayload } from "./gemini-user-payload.ts";
import {
  MULTI_SYMBOL_BATCH_INSTRUCTION,
  parseMultiSymbolLlmContentToMap,
} from "./ai-multi-symbol-parse.ts";
import {
  clearMultiSymbolBatch,
  setMultiSymbolBatchResults,
  takeMultiSymbolBatchAi,
} from "./ai-multi-symbol-batch-store.ts";

export function setGeminiMultiSymbolBatchResults(map: Map<string, AiAnalysis>): void {
  setMultiSymbolBatchResults(map, "gemini");
}

export function readGeminiMultiSymbolBatchEnabled(): boolean {
  const raw = String(Deno.env.get("GEMINI_MULTI_SYMBOL_BATCH") ?? "")
    .trim()
    .toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  return !readAiPrimaryLlmIsGroq();
}

export const clearGeminiMultiSymbolBatch = clearMultiSymbolBatch;
export const takeGeminiMultiSymbolBatchAi = takeMultiSymbolBatchAi;

export async function geminiAnalyzeMultiSymbol(
  geminiKey: string,
  items: Array<{ symbol: string; data: unknown }>,
  signal?: AbortSignal,
): Promise<Map<string, AiAnalysis>> {
  const maxTokRaw = Number(Deno.env.get("GEMINI_MULTI_SYMBOL_MAX_OUTPUT_TOKENS") ?? "");
  const maxOut = Number.isFinite(maxTokRaw) && maxTokRaw >= 1024
    ? Math.min(16_384, Math.floor(maxTokRaw))
    : 8192;
  const envelope = {
    symbols: items.map((row) => ({
      s: row.symbol,
      d: buildMinifiedGeminiPayload(row.data),
    })),
  };
  const userText = `D:${JSON.stringify(envelope)}`;
  const systemText = `${buildGeminiScanSystemForCache()}\n${MULTI_SYMBOL_BATCH_INSTRUCTION}`;
  const reqSignal = mergeLlmAbortSignal(
    signal,
    envLlmTimeoutMs("GEMINI_MULTI_SYMBOL_TIMEOUT_MS", 90_000),
  );
  const response = await geminiGenerateContent({
    apiKey: geminiKey,
    userText,
    systemInstruction: systemText,
    cacheProfile: "scan",
    signal: reqSignal,
    maxOutputTokens: maxOut,
  });
  if (response.status === 429) {
    throw new Error(
      "QUOTA_EXHAUSTED: Gemini returned 429 (multi-symbol batch)",
    );
  }
  if (!response.ok) {
    const text = await response.text();
    const model = readGeminiModelId();
    throw new Error(
      `Gemini multi error: ${response.status} model=${model} body=${text.slice(0, 400)}`,
    );
  }
  const json = await response.json();
  const batchSym = items.map((i) => String(i.symbol).toUpperCase()).join("|") || "BATCH";
  emitGeminiTelemetry(batchSym, "gemini_multi", json);
  return parseMultiSymbolLlmContentToMap(extractGeminiText(json), items);
}
