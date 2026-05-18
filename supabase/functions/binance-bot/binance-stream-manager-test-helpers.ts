// @ts-nocheck
/** Test-only exports — stream URL builder mirror. */

const WS_BASE = "wss://stream.binance.com:9443/stream?streams=";

export function buildCombinedStreamUrlForTest(symbols: string[]): string {
  const streams: string[] = [];
  for (const symbol of symbols) {
    const s = symbol.toLowerCase();
    streams.push(`${s}@ticker`, `${s}@bookTicker`, `${s}@kline_1m`);
  }
  return `${WS_BASE}${streams.join("/")}`;
}
