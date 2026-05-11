import type { StreamTick } from "./types.ts";

const ticks = new Map<string, StreamTick>();
const rollingHigh = new Map<string, { price: number; ts: number }>();

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

export function updateAggTrade(symbol: string, price: number, ts: number) {
  if (!(price > 0)) return;
  const key = symbol.toUpperCase();
  const prev = ticks.get(key) ?? emptyTick(key);
  ticks.set(key, { ...prev, symbol: key, last: price, lastTradeTs: ts });
  const high = rollingHigh.get(key);
  if (!high || price >= high.price) {
    rollingHigh.set(key, { price, ts });
    return;
  }
  if (ts - high.ts > 60_000) {
    rollingHigh.set(key, { price, ts });
  }
}

export function updateBookTicker(
  symbol: string,
  bid: number,
  ask: number,
  ts: number,
) {
  const key = symbol.toUpperCase();
  const prev = ticks.get(key) ?? emptyTick(key);
  const last = prev.last > 0
    ? prev.last
    : bid > 0 && ask > 0
    ? Number(((bid + ask) / 2).toFixed(12))
    : ask > 0
    ? ask
    : bid;
  ticks.set(key, {
    ...prev,
    symbol: key,
    bid,
    ask,
    last,
    bookTickerTs: ts,
  });
}

export function getTick(symbol: string): StreamTick | null {
  const row = ticks.get(symbol.toUpperCase());
  if (!row) return null;
  if (!(row.last > 0) && !(row.bid > 0) && !(row.ask > 0)) return null;
  return row;
}

export function getRollingHigh(symbol: string): { price: number; ts: number } | null {
  return rollingHigh.get(symbol.toUpperCase()) ?? null;
}
