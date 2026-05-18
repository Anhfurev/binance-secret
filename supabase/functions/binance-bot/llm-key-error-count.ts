// @ts-nocheck
/** Per-row `llm_api_keys.error_count` ceiling — blocks HTTP before a 3rd strike. */

const projectedErrorCountByDbId = new Map<string, number>();

export function readLlmMaxErrorCountPerKey(): number {
  const n = Number(Deno.env.get("LLM_API_KEY_MAX_ERROR_COUNT") ?? "2");
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.min(10, Math.floor(n));
}

/** Inclusive: at max → exhausted (no further HTTP / DB increment). */
export function isLlmErrorCountExhausted(errorCount: number): boolean {
  const n = Number(errorCount);
  if (!Number.isFinite(n) || n < 0) return false;
  return n >= readLlmMaxErrorCountPerKey();
}

export function getEffectiveLlmKeyErrorCount(
  dbRowId: string,
  rowErrorCount = 0,
): number {
  const id = String(dbRowId ?? "").trim();
  if (!id) return Math.max(0, Math.floor(rowErrorCount));
  const projected = projectedErrorCountByDbId.get(id);
  const base = Math.max(0, Math.floor(rowErrorCount));
  return Math.max(base, projected ?? 0);
}

/**
 * Atomic in-process reserve: bump projected count BEFORE RPC.
 * Returns false when effective count is already >= max (no 3rd attempt).
 */
export function tryReserveLlmKeyErrorIncrement(
  dbRowId: string,
  rowErrorCount = 0,
): boolean {
  const id = String(dbRowId ?? "").trim();
  if (!id) return false;
  const effective = getEffectiveLlmKeyErrorCount(id, rowErrorCount);
  if (isLlmErrorCountExhausted(effective)) return false;
  projectedErrorCountByDbId.set(id, effective + 1);
  return true;
}

export function releaseLlmKeyErrorIncrementReservation(dbRowId: string): void {
  const id = String(dbRowId ?? "").trim();
  if (!id) return;
  const cur = projectedErrorCountByDbId.get(id);
  if (cur == null || cur <= 0) {
    projectedErrorCountByDbId.delete(id);
    return;
  }
  if (cur <= 1) projectedErrorCountByDbId.delete(id);
  else projectedErrorCountByDbId.set(id, cur - 1);
}

export function clearLlmKeyErrorCountProjections(): void {
  projectedErrorCountByDbId.clear();
}
