/** Core 10 — matches `DEFAULT_PAPER_WATCH_SYMBOLS` in paper-scalp-settings. */
export const WATCH_SYMBOLS = [
  "BTCUSDT",
  "SOLUSDT",
  "PEPEUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "LINKUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
] as const;

export function buildCombinedKline15mUrl(): string {
  const streams = WATCH_SYMBOLS.map(
    (s) => `${s.toLowerCase()}@kline_15m`,
  ).join("/");
  return `wss://stream.binance.com:9443/stream?streams=${streams}`;
}
