/** One-time REST seed for kline buffers (hub startup only — not per trading cycle). */

import { readSymbols } from "./config.ts";
import { seedKlines, type HubCandle } from "./kline-store.ts";
import { refreshMarketCacheEntry } from "./market-cache.ts";
import { updateBookTicker } from "./symbol-store.ts";

const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
const LIMITS: Record<string, number> = {
  "1m": 400,
  "5m": 24,
  "15m": 80,
  "1h": 60,
  "4h": 36,
  "1d": 40,
};

function parseRestKlines(raw: unknown): HubCandle[] {
  if (!Array.isArray(raw)) return [];
  const out: HubCandle[] = [];
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
): Promise<HubCandle[]> {
  const limit = LIMITS[interval] ?? 200;
  const url =
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  return parseRestKlines(await res.json());
}

export async function bootstrapMarketCacheFromRest(): Promise<void> {
  const symbols = readSymbols();
  console.log(`[hub-bootstrap] seeding klines symbols=${symbols.join(",")}`);
  for (const symbol of symbols) {
    for (const interval of INTERVALS) {
      const candles = await fetchSeedKlines(symbol, interval);
      if (candles.length) seedKlines(symbol, interval, candles);
    }
    const last = await fetchSeedKlines(symbol, "1m");
    const close = last.at(-1)?.close ?? 0;
    if (close > 0) {
      updateBookTicker(symbol, close, close, Date.now());
    }
    refreshMarketCacheEntry(symbol);
  }
  console.log("[hub-bootstrap] seed complete");
}
