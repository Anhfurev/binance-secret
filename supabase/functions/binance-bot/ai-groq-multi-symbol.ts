// @ts-nocheck
/**
 * One Groq completion per cron for all active symbols (RPM/TPM). Prefills `getAiAnalysis` via in-memory map.
 *
 * - **Default:** on when `AI_PRIMARY_LLM=groq` and env is unset. Set `GROQ_MULTI_SYMBOL_BATCH=0` to disable.
 * - **Force on:** `GROQ_MULTI_SYMBOL_BATCH=1` even if Gemini is primary (advanced).
 */
import type { AiAnalysis } from "./types.ts";
import {
  AI_USER_DATA_PREFIX,
  envLlmTimeoutMs,
  fetchWithExponentialBackoff,
  mergeLlmAbortSignal,
} from "./ai-models.ts";
import { emitGroqTelemetry } from "./ai-llm-telemetry.ts";
import { resolveGroqScanModel } from "./ai-groq-models.ts";
import { GROQ_SCAN_SYSTEM_MINIMAL } from "./ai-groq-scan-prompt.ts";
import { enforceGroqRequestSpacing } from "./groq-request-spacing.ts";
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

export function setGroqMultiSymbolBatchResults(map: Map<string, AiAnalysis>): void {
  setMultiSymbolBatchResults(map, "groq");
}

export function readGroqMultiSymbolBatchEnabled(): boolean {
  const raw = String(Deno.env.get("GROQ_MULTI_SYMBOL_BATCH") ?? "")
    .trim()
    .toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  return readAiPrimaryLlmIsGroq();
}

export const clearGroqMultiSymbolBatch = clearMultiSymbolBatch;
export const takeGroqMultiSymbolBatchAi = takeMultiSymbolBatchAi;

export async function groqAnalyzeMultiSymbol(
  groqKey: string,
  items: Array<{ symbol: string; data: unknown }>,
  signal?: AbortSignal,
): Promise<Map<string, AiAnalysis>> {
  const groqModel = resolveGroqScanModel();
  const maxTokRaw = Number(Deno.env.get("GROQ_MULTI_SYMBOL_MAX_TOKENS") ?? "");
  const maxTok =
    Number.isFinite(maxTokRaw) && maxTokRaw >= 1024
      ? Math.min(8192, Math.floor(maxTokRaw))
      : 4096;
  const envelope = { symbols: items };
  const reqSignal = mergeLlmAbortSignal(
    signal,
    envLlmTimeoutMs("GROQ_MULTI_SYMBOL_TIMEOUT_MS", 45_000),
  );
  await enforceGroqRequestSpacing(reqSignal);
  const response = await fetchWithExponentialBackoff(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: groqModel,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `${GROQ_SCAN_SYSTEM_MINIMAL}\n${MULTI_SYMBOL_BATCH_INSTRUCTION}`,
          },
          {
            role: "user",
            content: `${AI_USER_DATA_PREFIX}${JSON.stringify(envelope)}`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: maxTok,
      }),
    },
    0,
    reqSignal,
  );
  if (response.status === 429)
    throw new Error("QUOTA_EXHAUSTED: Groq returned 429 (no intra-key retry)");
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Groq multi error: ${response.status} model=${groqModel} body=${text.slice(0, 400)}`,
    );
  }
  const json = await response.json();
  const batchSym = items.map((i) => String(i.symbol).toUpperCase()).join("|") || "BATCH";
  emitGroqTelemetry(batchSym, "groq_multi", json);
  const content = json?.choices?.[0]?.message?.content ?? "";
  return parseMultiSymbolLlmContentToMap(content, items);
}
