// @ts-nocheck
/**
 * One Gemini completion per cron for all symbols when Gemini is primary (RPM). Same map as Groq batch.
 *
 * - **Default:** on when `AI_PRIMARY_LLM` is not `groq`. Set `GEMINI_MULTI_SYMBOL_BATCH=0` to disable.
 * - **Force on:** `GEMINI_MULTI_SYMBOL_BATCH=1` even when Groq is primary (advanced; cron still prefers primary).
 */
import type { AiAnalysis } from "./types.ts";
import {
  AI_SYSTEM_REST_API,
  AI_USER_DATA_PREFIX,
  envLlmTimeoutMs,
  mergeLlmAbortSignal,
} from "./ai-models.ts";
import { emitGeminiTelemetry } from "./ai-llm-telemetry.ts";
import { readAiPrimaryLlmIsGroq } from "./ai-llm-route.ts";
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

const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-lite";
const GEMINI_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models/";

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

function resolveGeminiMultiModel(): string {
  const m = (Deno.env.get("GEMINI_SCAN_MODEL") ?? Deno.env.get("GEMINI_MODEL") ?? "")
    .trim();
  return m || GEMINI_DEFAULT_MODEL;
}

export async function geminiAnalyzeMultiSymbol(
  geminiKey: string,
  items: Array<{ symbol: string; data: unknown }>,
  signal?: AbortSignal,
): Promise<Map<string, AiAnalysis>> {
  const model = resolveGeminiMultiModel();
  const maxTokRaw = Number(Deno.env.get("GEMINI_MULTI_SYMBOL_MAX_OUTPUT_TOKENS") ?? "");
  const maxOut =
    Number.isFinite(maxTokRaw) && maxTokRaw >= 1024
      ? Math.min(16_384, Math.floor(maxTokRaw))
      : 8192;
  const envelope = { symbols: items };
  const userText = `${AI_USER_DATA_PREFIX}${JSON.stringify(envelope)}`;
  const systemText = `${AI_SYSTEM_REST_API}\n${MULTI_SYMBOL_BATCH_INSTRUCTION}`;
  const reqSignal = mergeLlmAbortSignal(
    signal,
    envLlmTimeoutMs("GEMINI_MULTI_SYMBOL_TIMEOUT_MS", 90_000),
  );
  const url = `${GEMINI_BASE}${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;
  const response = await fetch(url, {
    signal: reqSignal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userText }] }],
      systemInstruction: { parts: [{ text: systemText }] },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: maxOut,
        responseMimeType: "application/json",
      },
    }),
  });
  if (response.status === 429) {
    throw new Error(
      "QUOTA_EXHAUSTED: Gemini returned 429 (multi-symbol batch)",
    );
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Gemini multi error: ${response.status} model=${model} body=${text.slice(0, 400)}`,
    );
  }
  const json = await response.json();
  const batchSym = items.map((i) => String(i.symbol).toUpperCase()).join("|") || "BATCH";
  emitGeminiTelemetry(batchSym, "gemini_multi", json);
  const content = (json?.candidates ?? [])
    .flatMap((c: { content?: { parts?: { text?: string }[] } }) => c?.content?.parts ?? [])
    .map((p: { text?: string }) => p?.text ?? "")
    .join("");
  return parseMultiSymbolLlmContentToMap(content, items);
}
