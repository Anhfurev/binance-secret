/** Global in-memory market cache — updated by WebSocket handlers (sync reads). */

import { isKlinePrimed, readKlines, type HubCandle } from "./kline-store.ts";
import { getTick } from "./symbol-store.ts";
import type { StreamTick } from "./types.ts";

export type MiniTicker24h = {
  last: number;
  high: number;
  low: number;
  quoteVolume: number;
  baseVolume: number;
  updatedAtMs: number;
};

export type MarketCacheEntry = {
  symbol: string;
  tick: StreamTick;
  mini: MiniTicker24h | null;
  klines1m: HubCandle[];
  klines5m: HubCandle[];
  klines15m: HubCandle[];
  klines1h: HubCandle[];
  klines4h: HubCandle[];
  klines1d: HubCandle[];
  ready: boolean;
  updatedAtMs: number;
};

/** Event-driven cache — `marketCache[symbol]` for O(1) lookup. */
export const marketCache: Record<string, MarketCacheEntry> = {};

function emptyTick(symbol: string): StreamTick {
  return {
    symbol,
    last: 0,
    bid: 0,
    ask: 0,
    lastTradeTs: 0,
    bookTickerTs: 0,
  };
}

function ensureEntry(symbol: string): MarketCacheEntry {
  const sym = symbol.toUpperCase();
  if (!marketCache[sym]) {
    marketCache[sym] = {
      symbol: sym,
      tick: emptyTick(sym),
      mini: null,
      klines1m: [],
      klines5m: [],
      klines15m: [],
      klines1h: [],
      klines4h: [],
      klines1d: [],
      ready: false,
      updatedAtMs: 0,
    };
  }
  return marketCache[sym]!;
}

export function refreshMarketCacheEntry(symbol: string): void {
  const entry = ensureEntry(symbol);
  const liveTick = getTick(symbol);
  if (liveTick) entry.tick = liveTick;
  entry.klines1m = readKlines(symbol, "1m");
  entry.klines5m = readKlines(symbol, "5m");
  entry.klines15m = readKlines(symbol, "15m");
  entry.klines1h = readKlines(symbol, "1h");
  entry.klines4h = readKlines(symbol, "4h");
  entry.klines1d = readKlines(symbol, "1d");
  entry.ready = isKlinePrimed(symbol) && entry.tick.last > 0;
  entry.updatedAtMs = Date.now();
}

/** Synchronous read — used by HTTP handlers and in-process consumers. */
export function getMarketCacheEntry(symbol: string): MarketCacheEntry | null {
  const row = marketCache[symbol.toUpperCase()];
  if (!row?.ready) return null;
  return row;
}

export function patchMiniTicker(
  symbol: string,
  patch: Partial<MiniTicker24h>,
): void {
  const entry = ensureEntry(symbol);
  const prev = entry.mini ?? {
    last: 0,
    high: 0,
    low: 0,
    quoteVolume: 0,
    baseVolume: 0,
    updatedAtMs: 0,
  };
  entry.mini = { ...prev, ...patch, updatedAtMs: Date.now() };
  refreshMarketCacheEntry(symbol);
}
