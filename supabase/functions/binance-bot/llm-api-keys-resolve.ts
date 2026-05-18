// @ts-nocheck
import type { GeminiKeySlot } from "./ai-keys.ts";
import {
  dedupeGeminiKeySlotsByValue,
  getGeminiKeySlotsFromEnv,
  getGroqKeysFromEnv,
  getGroqScanKeysFromEnv,
} from "./ai-keys.ts";
import {
  fetchAvailableLlmApiKeys,
  readLlmApiKeysDbEnabled,
} from "./llm-api-keys-repo.ts";
import type { GroqKeyPlan, LlmApiKeyRow } from "./llm-api-keys-types.ts";

function readLlmApiKeysMergeEnv(): boolean {
  const raw = String(Deno.env.get("LLM_API_KEYS_MERGE_ENV") ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no";
}

function mergeGroqDbWithEnv(
  dbKeys: string[],
  dbIds: (string | undefined)[],
  dbErrorCounts: (number | undefined)[],
  dbStatuses: (LlmApiKeyRow["status"] | undefined)[],
  dbCooldownUntils: (string | null | undefined)[],
): GroqKeyPlan {
  if (!readLlmApiKeysMergeEnv()) {
    return {
      scanKeys: dbKeys,
      vetoKeys: dbKeys,
      scanDbIds: dbIds,
      vetoDbIds: dbIds,
      scanDbErrorCounts: dbErrorCounts,
      vetoDbErrorCounts: dbErrorCounts,
      scanDbStatuses: dbStatuses,
      vetoDbStatuses: dbStatuses,
      scanDbCooldownUntils: dbCooldownUntils,
      vetoDbCooldownUntils: dbCooldownUntils,
      source: "db",
      useDbHardTimeout: true,
    };
  }
  const envPlan = envGroqPlan();
  const seen = new Set(dbKeys);
  const scanKeys = [...dbKeys];
  const scanDbIds = [...dbIds];
  const scanDbErrorCounts = [...dbErrorCounts];
  const scanDbStatuses = [...dbStatuses];
  const scanDbCooldownUntils = [...dbCooldownUntils];
  for (let i = 0; i < envPlan.scanKeys.length; i += 1) {
    const k = envPlan.scanKeys[i];
    if (!k || seen.has(k)) continue;
    seen.add(k);
    scanKeys.push(k);
    scanDbIds.push(undefined);
    scanDbErrorCounts.push(undefined);
    scanDbStatuses.push(undefined);
    scanDbCooldownUntils.push(undefined);
  }
  return {
    scanKeys,
    vetoKeys: scanKeys,
    scanDbIds,
    vetoDbIds: scanDbIds,
    scanDbErrorCounts,
    vetoDbErrorCounts: scanDbErrorCounts,
    scanDbStatuses,
    vetoDbStatuses: scanDbStatuses,
    scanDbCooldownUntils,
    vetoDbCooldownUntils: scanDbCooldownUntils,
    source: "db",
    useDbHardTimeout: true,
  };
}

function mergeGeminiDbWithEnv(
  dbSlots: GeminiKeySlot[],
): GeminiKeySlot[] {
  const dedupedDb = dedupeGeminiKeySlotsByValue(dbSlots);
  if (!readLlmApiKeysMergeEnv()) return dedupedDb;
  const envSlots = getGeminiKeySlotsFromEnv();
  const seen = new Set(dedupedDb.map((s) => s.value));
  const merged = [...dedupedDb];
  for (const slot of envSlots) {
    if (!slot.value || seen.has(slot.value)) continue;
    seen.add(slot.value);
    merged.push(slot);
  }
  return dedupeGeminiKeySlotsByValue(merged);
}

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
    scanDbErrorCounts: scanKeys.map(() => u),
    vetoDbErrorCounts: vetoKeys.map(() => u),
    scanDbStatuses: scanKeys.map(() => u),
    vetoDbStatuses: vetoKeys.map(() => u),
    scanDbCooldownUntils: scanKeys.map(() => u),
    vetoDbCooldownUntils: vetoKeys.map(() => u),
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
  const errCounts = rows.map((r) => r.error_count);
  const statuses = rows.map((r) => r.status);
  const cooldowns = rows.map((r) => r.cooldown_until);
  return mergeGroqDbWithEnv(scanKeys, ids, errCounts, statuses, cooldowns);
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
  const dbSlots = dedupeGeminiKeySlotsByValue(rows.map((r) => ({
    value: r.api_key,
    label: `llm_api_keys:${r.id}`,
    llmDbKeyId: r.id,
    llmDbErrorCount: r.error_count,
    llmDbStatus: r.status,
    llmDbCooldownUntil: r.cooldown_until,
  })));
  return mergeGeminiDbWithEnv(dbSlots);
}
