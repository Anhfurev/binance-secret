// @ts-nocheck
/**
 * Isolate-hoisted time sync — loaded from `index.ts` before `Deno.serve`.
 * (`marketCache` lives in `market-cache-ws.ts` — same isolate singleton pattern.)
 */

/** `serverTimeMs - localMs` at last successful `/api/v3/time` sync. */
export let cachedTimeOffset = 0;

/** `Date.now()` when `cachedTimeOffset` was last applied. */
export let lastSyncTime = 0;

export function applyBinanceTimeOffset(serverTimeMs: number, localMs = Date.now()): void {
  cachedTimeOffset = serverTimeMs - localMs;
  lastSyncTime = localMs;
}

export function readHoistedTimeOffset(): number {
  return cachedTimeOffset;
}

export function readHoistedLastSyncTime(): number {
  return lastSyncTime;
}
