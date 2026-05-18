// @ts-nocheck
/** Global in-memory market cache — updated by native Binance WebSocket (sync reads). */

import {
  isWsKlinePrimed,
  readWsKlines,
  type WsHubCandle,
} from "./ws-kline-store.ts";
import type { StreamMarketPayload } from "./market-stream-payload.ts";
import type { Candle } from "./types.ts";

export type WsStreamTick = {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  lastTradeTs: number;
  bookTickerTs: number;
};

export type WsMiniTicker24h = {
  last: number;
  high: number;
  low: number;
  quoteVolume: number;
  baseVolume: number;
  updatedAtMs: number;
};

export type WsMarketCacheEntry = {
  symbol: string;
  tick: WsStreamTick;
  mini: WsMiniTicker24h | null;
  ready: boolean;
  updatedAtMs: number;
};

/** Top-level live cache — hoisted via `index.ts` module init (warm isolate reuse). */
export const marketCache = new Map<string, WsMarketCacheEntry>();

function emptyTick(symbol: string): WsStreamTick {
  return {
    symbol,
    last: 0,
    bid: 0,
    ask: 0,
    lastTradeTs: 0,
    bookTickerTs: 0,
  };
}

function ensureEntry(symbol: string): WsMarketCacheEntry {
  const sym = symbol.toUpperCase();
  let row = marketCache.get(sym);
  if (!row) {
    row = {
      symbol: sym,
      tick: emptyTick(sym),
      mini: null,
      ready: false,
      updatedAtMs: 0,
    };
    marketCache.set(sym, row);
  }
  return row;
}

function hubToCandles(rows: WsHubCandle[]): Candle[] {
  return rows.map((c) => ({
    openTime: c.openTime,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

export function refreshWsMarketCacheEntry(symbol: string): void {
  const entry = ensureEntry(symbol);
  entry.ready = isWsKlinePrimed(symbol) && entry.tick.last > 0;
  entry.updatedAtMs = Date.now();
}

export function patchWsBookTicker(
  symbol: string,
  bid: number,
  ask: number,
  ts = Date.now(),
): void {
  const entry = ensureEntry(symbol);
  entry.tick.bid = bid;
  entry.tick.ask = ask;
  entry.tick.bookTickerTs = ts;
  if (!(entry.tick.last > 0) && bid > 0) entry.tick.last = (bid + ask) / 2;
  refreshWsMarketCacheEntry(symbol);
}

export function patchWsAggTrade(symbol: string, price: number, ts: number): void {
  const entry = ensureEntry(symbol);
  entry.tick.last = price;
  entry.tick.lastTradeTs = ts;
  refreshWsMarketCacheEntry(symbol);
}

export function patchWsMiniTicker(
  symbol: string,
  patch: Partial<WsMiniTicker24h>,
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
  if (patch.last && patch.last > 0) entry.tick.last = patch.last;
  refreshWsMarketCacheEntry(symbol);
}

export function getWsMarketCacheEntry(symbol: string): WsMarketCacheEntry | null {
  const row = marketCache.get(symbol.toUpperCase());
  if (!row?.ready) return null;
  return row;
}

export function isWsMarketCacheReady(symbol: string): boolean {
  return Boolean(getWsMarketCacheEntry(symbol));
}

export function wsMarketEntryToStreamPayload(
  entry: WsMarketCacheEntry,
): StreamMarketPayload {
  const sym = entry.symbol;
  return {
    ok: true,
    symbol: sym,
    updated_at_ms: entry.updatedAtMs,
    tick: { ...entry.tick },
    mini: entry.mini,
    klines: {
      "1m": hubToCandles(readWsKlines(sym, "1m")),
      "5m": hubToCandles(readWsKlines(sym, "5m")),
      "15m": hubToCandles(readWsKlines(sym, "15m")),
      "1h": hubToCandles(readWsKlines(sym, "1h")),
      "4h": hubToCandles(readWsKlines(sym, "4h")),
      "1d": hubToCandles(readWsKlines(sym, "1d")),
    },
  };
}
