/** In-memory OHLCV ring buffers fed by Binance `@kline_*` WebSocket events. */

export type HubCandle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const buffers = new Map<string, Map<string, HubCandle[]>>();

const DEFAULT_LIMITS: Record<string, number> = {
  "1m": 400,
  "5m": 24,
  "15m": 80,
  "1h": 60,
  "4h": 36,
  "1d": 40,
};

function key(symbol: string, interval: string): string {
  return `${symbol.toUpperCase()}:${interval}`;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function seedKlines(
  symbol: string,
  interval: string,
  candles: HubCandle[],
): void {
  const sym = symbol.toUpperCase();
  const lim = DEFAULT_LIMITS[interval] ?? 200;
  const trimmed = candles.slice(-lim);
  let byInterval = buffers.get(sym);
  if (!byInterval) {
    byInterval = new Map();
    buffers.set(sym, byInterval);
  }
  byInterval.set(interval, trimmed);
}

export function applyKlineWsEvent(
  symbol: string,
  interval: string,
  k: Record<string, unknown>,
): void {
  const sym = symbol.toUpperCase();
  const openTime = toNum(k.t);
  if (!openTime) return;
  const candle: HubCandle = {
    openTime,
    open: toNum(k.o),
    high: toNum(k.h),
    low: toNum(k.l),
    close: toNum(k.c),
    volume: toNum(k.v),
  };
  if (!(candle.close > 0)) return;
  let byInterval = buffers.get(sym);
  if (!byInterval) {
    byInterval = new Map();
    buffers.set(sym, byInterval);
  }
  const lim = DEFAULT_LIMITS[interval] ?? 200;
  const list = [...(byInterval.get(interval) ?? [])];
  const idx = list.findIndex((c) => c.openTime === openTime);
  if (idx >= 0) list[idx] = candle;
  else list.push(candle);
  list.sort((a, b) => a.openTime - b.openTime);
  byInterval.set(interval, list.slice(-lim));
}

export function readKlines(symbol: string, interval: string): HubCandle[] {
  return [...(buffers.get(symbol.toUpperCase())?.get(interval) ?? [])];
}

export function isKlinePrimed(symbol: string): boolean {
  return readKlines(symbol, "1m").length >= 200;
}
