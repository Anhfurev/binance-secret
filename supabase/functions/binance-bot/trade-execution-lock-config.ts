// @ts-nocheck
/** Tunable lock TTL / prune cadence (unit-tested; Edge reads Deno.env at runtime). */

export const DEFAULT_STALE_MS = 180_000;
export const DEFAULT_PRUNE_MIN_INTERVAL_MS = 60_000;

export function parseStaleMs(raw: string): number {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) && n >= 30_000 ? Math.min(600_000, Math.floor(n)) : DEFAULT_STALE_MS;
}

export function parsePruneMinIntervalMs(raw: string): number {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) && n >= 5_000
    ? Math.min(600_000, Math.floor(n))
    : DEFAULT_PRUNE_MIN_INTERVAL_MS;
}

export function shouldRunStaleLockPrune(
  lastPruneAtMs: number,
  nowMs: number,
  minIntervalMs: number,
): boolean {
  return nowMs - lastPruneAtMs >= minIntervalMs;
}
