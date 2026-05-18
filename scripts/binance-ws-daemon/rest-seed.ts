import type { CandleSeed } from "./kline-math";
import { WATCH_SYMBOLS } from "./symbols";
import { seedSymbolHistory } from "./velocity-watch";

async function fetchSeedCandles(symbol: string): Promise<CandleSeed[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=100`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const rows = (await res.json()) as unknown[][];
  return rows
    .map((row) => ({
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    .filter(
      (c) =>
        [c.open, c.high, c.low, c.close, c.volume].every(
          (n) => Number.isFinite(n) && n > 0,
        ),
    );
}

export async function seedAllSymbolsFromRest(): Promise<void> {
  await Promise.all(
    WATCH_SYMBOLS.map(async (symbol) => {
      try {
        const candles = await fetchSeedCandles(symbol);
        if (candles.length > 0) seedSymbolHistory(symbol, candles);
      } catch {
        /* REST seed optional */
      }
    }),
  );
}
