// @ts-nocheck
/**
 * Long-lived background services: native Binance WS + stale time-sync refresh.
 * Started via `edgeWaitUntil` from the HTTP handler (Supabase) or detached on bare Deno.
 */

import { ensureBinanceStreamManager, isNativeBinanceWsMarketCacheEnabled } from "./binance-stream-manager.ts";
import { bootstrapWsMarketCacheFromRest } from "./binance-ws-bootstrap.ts";
import {
  initBinanceTimeSyncForCron,
  isBinanceTimeCacheWarm,
  kickoffBackgroundBinanceTimeSync,
} from "./binance-time-cache.ts";
import { edgeWaitUntil, isSupabaseEdgeRuntime } from "./edge-runtime.ts";
import { isWsMarketCacheReady } from "./market-cache-ws.ts";

let lifelineStarted = false;

async function warmMarketCacheIfCold(symbols: string[]): Promise<void> {
  if (!isNativeBinanceWsMarketCacheEnabled()) return;
  const cold = symbols.filter((s) => !isWsMarketCacheReady(s));
  if (!cold.length) return;
  try {
    await bootstrapWsMarketCacheFromRest(cold);
  } catch (error) {
    console.warn(
      `[server-lifecycle] market_bootstrap: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function runServerLifelineWork(symbols: string[]): Promise<void> {
  if (isNativeBinanceWsMarketCacheEnabled()) {
    ensureBinanceStreamManager(symbols);
    void warmMarketCacheIfCold(symbols);
  }
  if (isBinanceTimeCacheWarm()) {
    kickoffBackgroundBinanceTimeSync();
    return;
  }
  try {
    await initBinanceTimeSyncForCron();
  } catch (error) {
    console.warn(
      `[server-lifecycle] time_sync: ${error instanceof Error ? error.message : String(error)}`,
    );
    kickoffBackgroundBinanceTimeSync();
  }
}

/**
 * Attach WS stream + time-sync lifeline without blocking the cron HTTP response.
 * Safe to call from router (early) and cron-runner (post pool-hydrate).
 */
export function attachServerBackgroundLifeline(symbols: string[]): void {
  const normalized = [...new Set(
    symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean),
  )];
  if (!normalized.length) return;
  const streamWorkPromise = runServerLifelineWork(normalized).catch((err) => {
    console.error(
      "[server-lifecycle] lifeline_failed:",
      err instanceof Error ? err.message : String(err),
    );
  });
  edgeWaitUntil(streamWorkPromise);
  if (!lifelineStarted) {
    lifelineStarted = true;
    console.log(
      `[server-lifecycle] background lifeline attached supabase_edge=${isSupabaseEdgeRuntime() ? 1 : 0} symbols=${normalized.length}`,
    );
  }
}
