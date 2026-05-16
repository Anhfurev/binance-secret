// @ts-nocheck
import type { GeminiKeySlot } from "./ai-keys.ts";
import {
  getGeminiKeySlotsFromEnv,
  getGroqKeysFromEnv,
  getGroqScanKeysFromEnv,
} from "./ai-keys.ts";
import { fetchAvailableLlmApiKeys, readLlmApiKeysDbEnabled } from "./llm-api-keys-repo.ts";
import type { GroqKeyPlan } from "./llm-api-keys-types.ts";

function envGroqPlan(): GroqKeyPlan {
  const groqVetoKeysRaw = getGroqKeysFromEnv();
  const groqScanDedicated = getGroqScanKeysFromEnv();
  const scanKeys = groqScanDedicated.length ? groqScanDedicated : groqVetoKeysRaw;
  const vetoKeys = groqVetoKeysRaw.length ? groqVetoKeysRaw : scanKeys;
  const u = undefined;
  return {
    scanKeys,
    vetoKeys,
    scanDbIds: scanKeys.map(() => u),
    vetoDbIds: vetoKeys.map(() => u),
    source: "env",
    useDbHardTimeout: false,
  };
}

/**
 * When `LLM_API_KEYS_DB=1` and at least one eligible Groq row exists, scan + veto both use that pool.
 * Otherwise falls back to env keys (never throws — caller uses cache / HOLD paths).
 */
export async function resolveGroqKeyPlanForRuntime(): Promise<GroqKeyPlan> {
  if (!readLlmApiKeysDbEnabled()) return envGroqPlan();
  const rows = await fetchAvailableLlmApiKeys("groq");
  if (!rows.length) {
    console.warn(
      "[llm_api_keys] LLM_API_KEYS_DB enabled but zero eligible groq rows — using env keys",
    );
    return envGroqPlan();
  }
  const scanKeys = rows.map((r) => r.api_key);
  const ids = rows.map((r) => r.id);
  return {
    scanKeys,
    vetoKeys: scanKeys,
    scanDbIds: ids,
    vetoDbIds: ids,
    source: "db",
    useDbHardTimeout: true,
  };
}

/** Gemini slots from DB when enabled + rows; else env slots. */
export async function resolveGeminiSlotsForRuntime(): Promise<GeminiKeySlot[]> {
  if (!readLlmApiKeysDbEnabled()) return getGeminiKeySlotsFromEnv();
  const rows = await fetchAvailableLlmApiKeys("gemini");
  if (!rows.length) {
    console.warn(
      "[llm_api_keys] LLM_API_KEYS_DB enabled but zero eligible gemini rows — using env keys",
    );
    return getGeminiKeySlotsFromEnv();
  }
  return rows.map((r) => ({
    value: r.api_key,
    label: `llm_api_keys:${r.id}`,
    llmDbKeyId: r.id,
  }));
}
