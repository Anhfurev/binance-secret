// @ts-nocheck
/** Process-wide UTC cooldown ledger — closes parallel symbol race vs `llm_api_keys` DB lag. */

const COOLDOWN_MS_DEFAULT = 15 * 60 * 1000;

const untilMsByDbId = new Map<string, number>();
const untilMsByLockId = new Map<string, number>();

export function readUtcIsoNow(): string {
  return new Date().toISOString();
}

export function utcCooldownUntilIso(addMs = COOLDOWN_MS_DEFAULT): string {
  return new Date(Date.now() + addMs).toISOString();
}

export function readDefaultLlmCooldownMs(): number {
  const n = Number(Deno.env.get("LLM_API_KEY_COOLDOWN_MS") ?? String(COOLDOWN_MS_DEFAULT));
  if (!Number.isFinite(n) || n < 60_000) return COOLDOWN_MS_DEFAULT;
  return Math.min(60 * 60 * 1000, Math.floor(n));
}

export function markLocalLlmKeyCooldown(opts: {
  dbRowId?: string | null;
  lockId?: string | null;
  untilMs?: number;
}): number {
  const until = opts.untilMs ?? Date.now() + readDefaultLlmCooldownMs();
  const dbId = String(opts.dbRowId ?? "").trim();
  const lockId = String(opts.lockId ?? "").trim();
  if (dbId) untilMsByDbId.set(dbId, until);
  if (lockId) untilMsByLockId.set(lockId, until);
  return until;
}

function isUntilActive(until: number | undefined, nowMs: number): boolean {
  return until != null && Number.isFinite(until) && until > nowMs;
}

export function readLocalCooldownUntilMs(
  dbRowId?: string | null,
  lockId?: string | null,
): number | null {
  const now = Date.now();
  const dbId = String(dbRowId ?? "").trim();
  const lid = String(lockId ?? "").trim();
  if (dbId) {
    const u = untilMsByDbId.get(dbId);
    if (isUntilActive(u, now)) return u!;
    if (u != null) untilMsByDbId.delete(dbId);
  }
  if (lid) {
    const u = untilMsByLockId.get(lid);
    if (isUntilActive(u, now)) return u!;
    if (u != null) untilMsByLockId.delete(lid);
  }
  return null;
}

export function isLlmKeyLocallyCooling(
  dbRowId?: string | null,
  lockId?: string | null,
): boolean {
  return readLocalCooldownUntilMs(dbRowId, lockId) != null;
}

export function formatLocalCooldownUntilIso(
  dbRowId?: string | null,
  lockId?: string | null,
): string | null {
  const until = readLocalCooldownUntilMs(dbRowId, lockId);
  return until != null ? new Date(until).toISOString() : null;
}

export function logKeyRotationSkip(
  dbRowId: string,
  untilIso: string,
  detail?: string,
): void {
  const extra = detail ? ` (${detail})` : "";
  console.warn(
    `[KEY ROTATION] Key ${dbRowId} from llm_api_keys is cooling down until ${untilIso}. Rotating...${extra}`,
  );
}

export function clearLocalLlmKeyCooldownRegistry(): void {
  untilMsByDbId.clear();
  untilMsByLockId.clear();
}

export function readLocalCooldownRegistrySize(): number {
  return untilMsByDbId.size + untilMsByLockId.size;
}
