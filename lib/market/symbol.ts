/** Normalize user-facing symbols to Binance stream ids (e.g. BTC → BTCUSDT). */

const QUOTE_SUFFIXES = ["USDT", "USDC", "BUSD", "FDUSD", "BTC", "ETH"] as const;

export function normalizeTradingSymbol(raw: string): string {
  const upper = String(raw ?? "").trim().toUpperCase();
  if (!upper) return "";
  if (QUOTE_SUFFIXES.some((q) => upper.endsWith(q) && upper.length > q.length)) {
    return upper;
  }
  return `${upper}USDT`;
}

export function displayAssetSymbol(tradingSymbol: string): string {
  const sym = normalizeTradingSymbol(tradingSymbol);
  for (const q of QUOTE_SUFFIXES) {
    if (sym.endsWith(q) && sym.length > q.length) {
      return sym.slice(0, -q.length);
    }
  }
  return sym;
}
