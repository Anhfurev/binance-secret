// @ts-nocheck
/** Per-cron isolate: prevent parallel symbol lanes from using the same LLM key concurrently. */

import type { GeminiKeySlot } from "./ai-keys.ts";
import { normalizeLlmApiKeySecret } from "./ai-keys.ts";
import {
  clearLocalLlmKeyCooldownRegistry,
  isLlmKeyLocallyCooling,
  markLocalLlmKeyCooldown,
} from "./llm-local-cooldown-registry.ts";
import { clearLlmKeyFailurePersistLedger } from "./llm-key-failure-persist.ts";
import { clearLlmKeyDbFailureBudget } from "./llm-key-failure-budget.ts";
import { clearLlmKeyErrorCountProjections } from "./llm-key-error-count.ts";
import {
  classifyLlmKeyReleaseOutcome,
  isLlmBlockedHttpFailure,
  isLlmRateLimitHttpFailure,
} from "./llm-key-failure-classify.ts";

export type { LlmKeyReleaseOutcome } from "./llm-key-failure-classify.ts";
export { classifyLlmKeyReleaseOutcome } from "./llm-key-failure-classify.ts";

const activeInFlightKeys = new Set<string>();
/** One normalized API secret → one in-flight HTTP across parallel symbol lanes. */
const activeSecretKeys = new Set<string>();
/** One DB row → one in-flight HTTP across parallel symbol lanes. */
const activeDbRowIds = new Set<string>();
const batchFailedKeys = new Set<string>();
const batchFailedDbRowIds = new Set<string>();
const batchBlockedKeys = new Set<string>();
const batchBlockedDbRowIds = new Set<string>();
const lockDbRowByLockId = new Map<string, string>();

function secretLockPrefix(provider: "gemini" | "groq"): string {
  return `${provider}:secret:`;
}

export function resolveGeminiSecretLockId(apiKey: string): string | null {
  const v = normalizeLlmApiKeySecret(apiKey);
  return v ? `${secretLockPrefix("gemini")}${v}` : null;
}

export function resolveGroqSecretLockId(apiKey: string): string | null {
  const v = normalizeLlmApiKeySecret(apiKey);
  return v ? `${secretLockPrefix("groq")}${v}` : null;
}

/** Canonical inflight lock: one per API secret (parallel-safe across duplicate DB/env slots). */
export function resolveGeminiKeyLockId(slot: GeminiKeySlot): string {
  const secretLock = resolveGeminiSecretLockId(slot.value);
  if (secretLock) return secretLock;
  if (slot.llmDbKeyId) return `gemini:db:${slot.llmDbKeyId}`;
  return `gemini:env:${String(slot.value ?? "").trim()}`;
}

export function resolveGroqKeyLockId(key: string, dbId?: string): string {
  const secretLock = resolveGroqSecretLockId(key);
  if (secretLock) return secretLock;
  const k = String(key ?? "").trim();
  if (dbId) return `groq:db:${dbId}`;
  return `groq:env:${k}`;
}

function readSecretFromLockId(lockId: string): string | null {
  const m = /^(?:gemini|groq):secret:(.+)$/.exec(String(lockId ?? "").trim());
  return m?.[1] ?? null;
}

function resolveDbRowId(lockId: string, dbRowId?: string | null): string {
  return String(dbRowId ?? "").trim() ||
    lockDbRowByLockId.get(lockId) ||
    parseDbIdFromLockId(lockId) ||
    "";
}

export function clearLlmBatchKeyRegistry(): void {
  activeInFlightKeys.clear();
  activeSecretKeys.clear();
  activeDbRowIds.clear();
  batchFailedKeys.clear();
  batchFailedDbRowIds.clear();
  batchBlockedKeys.clear();
  batchBlockedDbRowIds.clear();
  lockDbRowByLockId.clear();
  clearLocalLlmKeyCooldownRegistry();
  clearLlmKeyFailurePersistLedger();
  clearLlmKeyDbFailureBudget();
  clearLlmKeyErrorCountProjections();
}

/** After isolated DB persist — prevent batch flush from re-recording the same row. */
export function evictLockIdFromBatchFailureSets(lockId: string): void {
  if (!lockId) return;
  activeInFlightKeys.delete(lockId);
  const secret = readSecretFromLockId(lockId);
  if (secret) activeSecretKeys.delete(secret);
  const dbId = parseDbIdFromLockId(lockId);
  if (dbId) {
    activeDbRowIds.delete(dbId);
    batchFailedDbRowIds.delete(dbId);
    batchBlockedDbRowIds.delete(dbId);
    lockDbRowByLockId.delete(lockId);
  }
  batchFailedKeys.delete(lockId);
  batchBlockedKeys.delete(lockId);
}

/** Another parallel lane holds this secret/row — transient, not a pool health failure. */
export function isLlmKeyInFlightBusy(
  lockId: string,
  dbRowId?: string | null,
): boolean {
  const secret = readSecretFromLockId(lockId);
  if (secret && activeSecretKeys.has(secret)) return true;
  const dbId = resolveDbRowId(lockId, dbRowId);
  if (dbId && activeDbRowIds.has(dbId)) return true;
  return activeInFlightKeys.has(lockId);
}

/** Batch-isolated after a live 429/403 HTTP outcome — do not reuse this cron cycle. */
export function isLlmKeyBatchEvicted(
  lockId: string,
  dbRowId?: string | null,
): boolean {
  const dbId = resolveDbRowId(lockId, dbRowId);
  if (dbId && (batchFailedDbRowIds.has(dbId) || batchBlockedDbRowIds.has(dbId))) return true;
  return batchFailedKeys.has(lockId) || batchBlockedKeys.has(lockId);
}

export function isLlmKeyUnavailable(
  lockId: string,
  dbRowId?: string | null,
): boolean {
  if (isLlmKeyLocallyCooling(dbRowId, lockId)) return true;
  if (isLlmKeyInFlightBusy(lockId, dbRowId)) return true;
  return isLlmKeyBatchEvicted(lockId, dbRowId);
}

export function tryAcquireLlmKey(
  lockId: string,
  dbRowId?: string | null,
): boolean {
  if (!lockId) return false;
  if (isLlmKeyLocallyCooling(dbRowId, lockId)) return false;
  if (isLlmKeyBatchEvicted(lockId, dbRowId)) return false;
  const secret = readSecretFromLockId(lockId);
  if (secret && activeSecretKeys.has(secret)) return false;
  const dbId = resolveDbRowId(lockId, dbRowId);
  if (dbId && activeDbRowIds.has(dbId)) return false;
  if (activeInFlightKeys.has(lockId)) return false;
  activeInFlightKeys.add(lockId);
  if (secret) activeSecretKeys.add(secret);
  if (dbId) {
    activeDbRowIds.add(dbId);
    lockDbRowByLockId.set(lockId, dbId);
  }
  return true;
}

function releaseInflightLease(lockId: string, dbRowId?: string | null): void {
  if (!lockId) return;
  activeInFlightKeys.delete(lockId);
  const secret = readSecretFromLockId(lockId);
  if (secret) activeSecretKeys.delete(secret);
  const dbId = resolveDbRowId(lockId, dbRowId);
  if (dbId) {
    activeDbRowIds.delete(dbId);
    lockDbRowByLockId.delete(lockId);
  }
}

export function releaseLlmKeyInflight(
  lockId: string,
  outcome: LlmKeyReleaseOutcome,
): void {
  releaseInflightLease(lockId);
}

export function markLlmKeyBatchFailed(lockId: string, dbRowId?: string | null): void {
  releaseInflightLease(lockId, dbRowId);
  const dbId = resolveDbRowId(lockId, dbRowId);
  if (dbId) {
    batchFailedDbRowIds.add(dbId);
    batchBlockedDbRowIds.delete(dbId);
    return;
  }
  batchFailedKeys.add(lockId);
  batchBlockedKeys.delete(lockId);
}

export function markLlmKeyBatchBlocked(lockId: string, dbRowId?: string | null): void {
  releaseInflightLease(lockId, dbRowId);
  const dbId = resolveDbRowId(lockId, dbRowId);
  if (dbId) {
    batchBlockedDbRowIds.add(dbId);
    batchFailedDbRowIds.delete(dbId);
    return;
  }
  batchBlockedKeys.add(lockId);
  batchFailedKeys.delete(lockId);
}

export function parseDbIdFromLockId(lockId: string): string | null {
  const m = /^(?:groq|gemini):db:([0-9a-f-]{36})$/i.exec(String(lockId ?? "").trim());
  return m?.[1] ?? null;
}

export function listBatchFailedDbIds(): string[] {
  return [...batchFailedDbRowIds];
}

export function listBatchBlockedDbIds(): string[] {
  return [...batchBlockedDbRowIds];
}

export function registerLlmKeyFailureFromError(
  lockId: string,
  err: unknown,
  dbRowId?: string | null,
): LlmKeyReleaseOutcome {
  const outcome = classifyLlmKeyReleaseOutcome(err);
  const rowId = String(dbRowId ?? "").trim() || parseDbIdFromLockId(lockId);
  if (outcome === "client_error") {
    releaseLlmKeyInflight(lockId, "error");
    return outcome;
  }
  if (outcome === "rate_limit" && isLlmRateLimitHttpFailure(err)) {
    markLlmKeyBatchFailed(lockId, rowId);
    markLocalLlmKeyCooldown({ dbRowId: rowId || undefined, lockId });
  } else if (outcome === "blocked" && isLlmBlockedHttpFailure(err)) {
    markLlmKeyBatchBlocked(lockId, rowId);
    markLocalLlmKeyCooldown({
      dbRowId: rowId || undefined,
      lockId,
      untilMs: Date.now() + 365 * 24 * 60 * 60 * 1000,
    });
  } else {
    releaseLlmKeyInflight(lockId, "error");
  }
  return outcome;
}

export function countLaneKeysAvailable(
  rotationOrder: number[],
  resolveLockId: (keyIndex: number) => string,
  shouldSkip: (keyIndex: number) => boolean,
  excludeKeyIndex?: number,
  resolveDbRowId?: (keyIndex: number) => string | undefined,
): number {
  let n = 0;
  for (const keyIndex of rotationOrder) {
    if (excludeKeyIndex != null && keyIndex === excludeKeyIndex) continue;
    if (shouldSkip(keyIndex)) continue;
    const lockId = resolveLockId(keyIndex);
    const dbId = resolveDbRowId?.(keyIndex);
    if (isLlmKeyUnavailable(lockId, dbId)) continue;
    n += 1;
  }
  return n;
}

export function readLlmBatchRegistryStats(): {
  inFlight: number;
  batchFailed: number;
  batchBlocked: number;
} {
  return {
    inFlight: activeInFlightKeys.size,
    batchFailed: batchFailedDbRowIds.size + batchFailedKeys.size,
    batchBlocked: batchBlockedDbRowIds.size + batchBlockedKeys.size,
  };
}
