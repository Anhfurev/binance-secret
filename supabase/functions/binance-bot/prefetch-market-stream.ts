// @ts-nocheck
/**
 * Event-driven market prefetch: native WS in-memory cache (zero REST on warm path).
 * `prefetchMarket` / `lookupMarketSnapshot` are synchronous Map reads after warm-up.
 */

import type { IndicatorSnapshot } from "./types.ts";
import { fetchIndicatorSnapshot } from "./binance.ts";
import { getCachedSnapshot } from "./index-ai.ts";
import { assembleIndicatorSnapshotFromStream } from "./market-snapshot-from-stream.ts";
import {
  ensureBinanceStreamManager,
  isNativeBinanceWsMarketCacheEnabled,
} from "./binance-stream-manager.ts";
import { bootstrapWsMarketCacheFromRest } from "./binance-ws-bootstrap.ts";
import {
  getWsMarketCacheEntry,
  isWsMarketCacheReady,
  wsMarketEntryToStreamPayload,
} from "./market-cache-ws.ts";
import {
  fetchStreamMarketsBulk,
  isStreamMarketPrefetchEnabled,
} from "./market-stream-hub-client.ts";

let bootstrapPromise: Promise<number> | null = null;

export function lookupMarketSnapshot(
  cache: Map<string, IndicatorSnapshot>,
  symbol: string,
): IndicatorSnapshot | null {
  return cache.get(String(symbol ?? "").trim().toUpperCase()) ?? null;
}

function assembleSnapshotFromWs(symbol: string): IndicatorSnapshot | null {
  const entry = getWsMarketCacheEntry(symbol);
  if (!entry) return null;
  try {
    return assembleIndicatorSnapshotFromStream(wsMarketEntryToStreamPayload(entry));
  } catch {
    return null;
  }
}

/**
 * Synchronous prefetch — no network when native WS cache is warm.
 * Returns null when cold; caller may REST-fallback once.
 */
export function prefetchMarket(
  cache: Map<string, IndicatorSnapshot>,
  symbol: string,
): IndicatorSnapshot | null {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return null;
  const hit = cache.get(sym);
  if (hit) return hit;
  const snap = assembleSnapshotFromWs(sym);
  if (snap) cache.set(sym, snap);
  return snap;
}

function prefetchMarketsFromWsCache(
  cache: Map<string, IndicatorSnapshot>,
  symbols: string[],
): { wsHits: number; cold: string[] } {
  let wsHits = 0;
  const cold: string[] = [];
  for (const sym of symbols) {
    const snap = prefetchMarket(cache, sym);
    if (snap) wsHits += 1;
    else cold.push(sym);
  }
  return { wsHits, cold };
}

async function ensureWsCacheBootstrapped(
  symbols: string[],
  signal?: AbortSignal,
): Promise<void> {
  const need = symbols.filter((s) => !isWsMarketCacheReady(s));
  if (!need.length) return;
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapWsMarketCacheFromRest(need, signal).finally(() => {
      bootstrapPromise = null;
    });
  }
  await bootstrapPromise;
}

export async function prefetchMarketIntoCache(
  cache: Map<string, IndicatorSnapshot>,
  symbols: string[],
  signal?: AbortSignal,
): Promise<{ streamHits: number; restFallbacks: number }> {
  const normalized = [...new Set(
    symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean),
  )];
  let streamHits = 0;
  let restFallbacks = 0;

  let misses: string[];
  if (isNativeBinanceWsMarketCacheEnabled()) {
    ensureBinanceStreamManager(normalized);
    await ensureWsCacheBootstrapped(normalized, signal);
    const ws = prefetchMarketsFromWsCache(cache, normalized);
    streamHits += ws.wsHits;
    misses = ws.cold.filter((sym) => !cache.has(sym));
  } else {
    misses = [...normalized];
  }

  if (!isNativeBinanceWsMarketCacheEnabled() && isStreamMarketPrefetchEnabled()) {
    const bulk = await fetchStreamMarketsBulk(misses.length ? misses : normalized, signal);
    for (const sym of normalized) {
      const payload = bulk.get(sym);
      if (!payload) continue;
      try {
        cache.set(sym, assembleIndicatorSnapshotFromStream(payload));
        streamHits += 1;
      } catch (error) {
        console.warn(
          `[prefetch_market] hub assemble failed ${sym}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    misses = normalized.filter((sym) => !cache.has(sym));
  }

  if (misses.length) {
    await Promise.all(misses.map((sym) =>
      safePrefetchRest(cache, sym, signal).then((ok) => {
        if (ok) restFallbacks += 1;
      })
    ));
  }

  console.log(
    `[prefetch_market] ws_hits=${streamHits} rest_fallbacks=${restFallbacks} total=${normalized.length} native_ws=${isNativeBinanceWsMarketCacheEnabled() ? 1 : 0}`,
  );
  return { streamHits, restFallbacks };
}

async function safePrefetchRest(
  cache: Map<string, IndicatorSnapshot>,
  symbol: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    await getCachedSnapshot(cache, symbol, fetchIndicatorSnapshot, signal);
    return cache.has(symbol);
  } catch {
    return false;
  }
}
