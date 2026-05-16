// @ts-nocheck
/** In-memory map: one LLM multi-symbol batch per cron (Groq or Gemini, never both). */
import type { AiAnalysis } from "./types.ts";
import { normalizeSymbol } from "./utils.ts";

export type MultiSymbolBatchProvider = "groq" | "gemini";

let batchResults: Map<string, AiAnalysis> | null = null;
let batchProvider: MultiSymbolBatchProvider | null = null;

export function clearMultiSymbolBatch(): void {
  batchResults = null;
  batchProvider = null;
}

export function setMultiSymbolBatchResults(
  map: Map<string, AiAnalysis>,
  provider: MultiSymbolBatchProvider,
): void {
  batchResults = map.size ? new Map(map) : null;
  batchProvider = map.size ? provider : null;
}

export function getMultiSymbolBatchProvider(): MultiSymbolBatchProvider | null {
  return batchProvider;
}

export function takeMultiSymbolBatchAi(symbol: string): AiAnalysis | null {
  if (!batchResults?.size) return null;
  const k = normalizeSymbol(symbol, symbol);
  const hit = batchResults.get(k);
  return hit ? { ...hit } : null;
}
