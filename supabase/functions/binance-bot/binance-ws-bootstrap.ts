// @ts-nocheck
/** One-time REST kline seed when native WS cache is cold (not per cron symbol loop). */

import { resolveBinanceRestBaseUrl } from "./binance-rest-base.ts";
import {
  patchWsBookTicker,
  refreshWsMarketCacheEntry,
} from "./market-cache-ws.ts";
import { seedWsKlines, type WsHubCandle } from "./ws-kline-store.ts";

const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
const LIMITS: Record<string, number> = {
  "1m": 400,
  "5m": 24,
  "15m": 80,
  "1h": 60,
  "4h": 36,
  "1d": 40,
};

function parseRestKlines(raw: unknown): WsHubCandle[] {
  if (!Array.isArray(raw)) return [];
  const out: WsHubCandle[] = [];
  for (const row of raw) {
    if (!Array.isArray(row)) continue;
    const openTime = Number(row[0]);
    const close = Number(row[4]);
    if (!openTime || !(close > 0)) continue;
    out.push({
      openTime,
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close,
      volume: Number(row[5] ?? 0),
    });
  }
  return out;
}

async function fetchSeedKlines(
  symbol: string,
  interval: string,
  signal?: AbortSignal,
): Promise<WsHubCandle[]> {
  const limit = LIMITS[interval] ?? 200;
  const base = resolveBinanceRestBaseUrl();
  const url =
    `${base}/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  return parseRestKlines(await res.json());
}

export async function bootstrapWsMarketCacheFromRest(
  symbols: string[],
  signal?: AbortSignal,
): Promise<number> {
  const list = [...new Set(symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
  let seeded = 0;
  for (const symbol of list) {
    if (signal?.aborted) break;
    for (const interval of INTERVALS) {
      const candles = await fetchSeedKlines(symbol, interval, signal);
      if (candles.length) seedWsKlines(symbol, interval, candles);
    }
    const last = await fetchSeedKlines(symbol, "1m", signal);
    const close = last.at(-1)?.close ?? 0;
    if (close > 0) patchWsBookTicker(symbol, close, close, Date.now());
    refreshWsMarketCacheEntry(symbol);
    if (last.length >= 200) seeded += 1;
  }
  console.log(`[ws-bootstrap] seeded=${seeded}/${list.length} symbols`);
  return seeded;
}
