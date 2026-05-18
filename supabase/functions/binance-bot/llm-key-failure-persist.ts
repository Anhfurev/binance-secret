// @ts-nocheck
/** One `llm_api_keys` row → at most one cooldown/blocked RPC per cron isolate (no shotgun flush). */

const persistedRowIds = new Set<string>();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidLlmApiKeyRowId(rowId: string): boolean {
  return UUID_RE.test(String(rowId ?? "").trim());
}

export function hasLlmKeyFailureBeenPersisted(rowId: string): boolean {
  const id = String(rowId ?? "").trim();
  return id.length > 0 && persistedRowIds.has(id);
}

export function markLlmKeyFailurePersisted(rowId: string): void {
  const id = String(rowId ?? "").trim();
  if (id) persistedRowIds.add(id);
}

export function clearLlmKeyFailurePersistLedger(): void {
  persistedRowIds.clear();
}

export function listPersistedLlmKeyFailureIds(): string[] {
  return [...persistedRowIds];
}
