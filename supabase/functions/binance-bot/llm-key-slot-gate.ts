// @ts-nocheck
import type { GeminiKeySlot } from "./ai-keys.ts";
import type { LlmApiKeyRow } from "./llm-api-keys-types.ts";
import {
  getEffectiveLlmKeyErrorCount,
  isLlmErrorCountExhausted,
} from "./llm-key-error-count.ts";

export type LlmDbKeySlotMeta = {
  dbRowId?: string;
  errorCount?: number;
  status?: LlmApiKeyRow["status"];
  cooldownUntil?: string | null;
};

export function geminiSlotToLlmMeta(slot: GeminiKeySlot): LlmDbKeySlotMeta {
  return {
    dbRowId: slot.llmDbKeyId,
    errorCount: slot.llmDbErrorCount,
    status: slot.llmDbStatus,
    cooldownUntil: slot.llmDbCooldownUntil ?? null,
  };
}

export function groqIndexToLlmMeta(
  keyIndex: number,
  dbIds?: (string | undefined)[],
  errorCounts?: (number | undefined)[],
  statuses?: (LlmApiKeyRow["status"] | undefined)[],
  cooldowns?: (string | null | undefined)[],
): LlmDbKeySlotMeta {
  return {
    dbRowId: dbIds?.[keyIndex],
    errorCount: errorCounts?.[keyIndex],
    status: statuses?.[keyIndex],
    cooldownUntil: cooldowns?.[keyIndex] ?? null,
  };
}

/**
 * Triple-guard before HTTP: blocked | cooldown status | error_count >= max | future cooldown_until.
 */
export function shouldSkipLlmDbSlotTripleGuard(
  meta: LlmDbKeySlotMeta,
  nowMs = Date.now(),
): boolean {
  const id = String(meta.dbRowId ?? "").trim();
  if (!id) return false;
  if (meta.status === "blocked") return true;
  if (meta.status === "cooldown") return true;
  if (
    isLlmErrorCountExhausted(
      getEffectiveLlmKeyErrorCount(id, meta.errorCount ?? 0),
    )
  ) {
    return true;
  }
  const untilMs = meta.cooldownUntil ? Date.parse(meta.cooldownUntil) : NaN;
  return Number.isFinite(untilMs) && untilMs > nowMs;
}

export function tripleGuardSkipReason(meta: LlmDbKeySlotMeta): string {
  if (meta.status === "blocked") return "status=blocked";
  if (meta.status === "cooldown") return "status=cooldown";
  const id = String(meta.dbRowId ?? "").trim();
  if (id && isLlmErrorCountExhausted(getEffectiveLlmKeyErrorCount(id, meta.errorCount ?? 0))) {
    return "error_count_cap";
  }
  return "cooldown_until_active";
}
