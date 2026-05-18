// @ts-nocheck
/**
 * In-memory Binance server time offset — non-blocking cron boot.
 * Warm path: zero HTTP. Cold + live signing: one blocking sync, then 24h cache.
 */

import { edgeWaitUntil } from "./edge-runtime.ts";
import { resolveBinanceRestBaseUrl } from "./binance-rest-base.ts";
import { gatewayFetch } from "./gateway-http-client.ts";
import { isPaperTradingEnvForced } from "./paper-trade-interceptor.ts";

import {
  applyBinanceTimeOffset,
  cachedTimeOffset,
  lastSyncTime,
  readHoistedLastSyncTime,
  readHoistedTimeOffset,
} from "./server-hoisted-state.ts";

let syncInFlight = false;

const CACHE_WARM_MS = 60 * 60 * 1000;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type BinanceTimeSyncSnapshot = {
  serverTime: number;
  driftMs: number;
  /** Used cached offset — no HTTP this cycle. */
  fromCache: boolean;
  /** No prior sync; background refresh scheduled. */
  coldBoot: boolean;
  /** Blocking REST ran this cycle (first live cold boot). */
  blockedSync: boolean;
};

function readCacheWarmMs(): number {
  const raw = Number(Deno.env.get("BINANCE_TIME_CACHE_WARM_MS") ?? "");
  if (!Number.isFinite(raw)) return CACHE_WARM_MS;
  return Math.min(6 * 60 * 60 * 1000, Math.max(60_000, Math.floor(raw)));
}

function readCacheMaxAgeMs(): number {
  const raw = Number(Deno.env.get("BINANCE_TIME_CACHE_MAX_AGE_MS") ?? "");
  if (!Number.isFinite(raw)) return CACHE_MAX_AGE_MS;
  return Math.min(48 * 60 * 60 * 1000, Math.max(readCacheWarmMs(), Math.floor(raw)));
}

export function getCachedTimeOffset(): number {
  return readHoistedTimeOffset();
}

export function getLastBinanceTimeSyncMs(): number {
  return readHoistedLastSyncTime();
}

/** Estimated Binance server clock (ms). */
export function getBinanceServerTimeMs(): number {
  return Date.now() + cachedTimeOffset;
}

export function isBinanceTimeCacheWarm(): boolean {
  if (!lastSyncTime) return false;
  return Date.now() - lastSyncTime < readCacheWarmMs();
}

export function isBinanceTimeCacheValid(): boolean {
  if (!lastSyncTime) return false;
  return Date.now() - lastSyncTime < readCacheMaxAgeMs();
}

function snapshotFromCache(extra: Partial<BinanceTimeSyncSnapshot> = {}): BinanceTimeSyncSnapshot {
  const serverTime = getBinanceServerTimeMs();
  return {
    serverTime,
    driftMs: Math.abs(cachedTimeOffset),
    fromCache: true,
    coldBoot: false,
    blockedSync: false,
    ...extra,
  };
}

export function requiresSignedBinanceRequests(): boolean {
  if (isPaperTradingEnvForced()) return false;
  const key = String(Deno.env.get("BINANCE_API_KEY") ?? "").trim();
  const secret = String(
    Deno.env.get("BINANCE_SECRET") ?? Deno.env.get("BINANCE_API_SECRET") ?? "",
  ).trim();
  return Boolean(key && secret);
}

async function fetchAndApplyTimeOffset(
  blocked = false,
): Promise<BinanceTimeSyncSnapshot> {
  const url = new URL(`${resolveBinanceRestBaseUrl()}/api/v3/time`);
  const response = await gatewayFetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Binance time check failed: ${response.status} ${detail}`);
  }
  const data = (await response.json()) as { serverTime?: number };
  const serverTime = typeof data.serverTime === "number" ? data.serverTime : 0;
  if (!serverTime) throw new Error("Binance time check missing serverTime");

  const localMs = Date.now();
  applyBinanceTimeOffset(serverTime, localMs);

  const snap: BinanceTimeSyncSnapshot = {
    serverTime,
    driftMs: Math.abs(cachedTimeOffset),
    fromCache: false,
    coldBoot: false,
    blockedSync: blocked,
  };
  console.log(
    `[time_sync] offset_ms=${cachedTimeOffset} drift_ms=${snap.driftMs} server=${serverTime} blocked=${blocked ? 1 : 0}`,
  );
  return snap;
}

/** Non-blocking `/api/v3/time` refresh (safe after HTTP response). */
export function kickoffBackgroundBinanceTimeSync(): void {
  scheduleBackgroundTimeSync();
}

function scheduleBackgroundTimeSync(): void {
  if (syncInFlight) return;
  syncInFlight = true;
  edgeWaitUntil(
    fetchAndApplyTimeOffset(false)
      .then((snap) => {
        console.log(
          `[time_sync] background ok drift_ms=${snap.driftMs} offset_ms=${cachedTimeOffset}`,
        );
      })
      .catch((err) => {
        console.warn(
          `[time_sync] background failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        syncInFlight = false;
      }),
  );
}

/**
 * Cron boot entry — does not block parallel symbol work when cache is warm.
 * Cold + live signing: one blocking `/time` (first cycle), cached 24h.
 */
export async function initBinanceTimeSyncForCron(): Promise<BinanceTimeSyncSnapshot> {
  if (isBinanceTimeCacheWarm()) {
    return snapshotFromCache();
  }

  const valid = isBinanceTimeCacheValid();
  const cold = !valid;
  const needsBlock = cold && requiresSignedBinanceRequests();

  if (needsBlock) {
    try {
      const snap = await fetchAndApplyTimeOffset(true);
      return { ...snap, coldBoot: true };
    } catch (error) {
      console.warn(
        `[time_sync] blocking cold sync failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      scheduleBackgroundTimeSync();
      return {
        serverTime: Date.now(),
        driftMs: 0,
        fromCache: false,
        coldBoot: true,
        blockedSync: false,
      };
    }
  }

  if (valid) {
    scheduleBackgroundTimeSync();
    return snapshotFromCache({ coldBoot: false });
  }

  scheduleBackgroundTimeSync();
  return {
    serverTime: Date.now(),
    driftMs: 0,
    fromCache: false,
    coldBoot: true,
    blockedSync: false,
  };
}

/** @deprecated — use `initBinanceTimeSyncForCron`. */
export async function binanceTimeSyncCheck(): Promise<{
  serverTime: number;
  driftMs: number;
}> {
  const snap = await initBinanceTimeSyncForCron();
  return { serverTime: snap.serverTime, driftMs: snap.driftMs };
}
