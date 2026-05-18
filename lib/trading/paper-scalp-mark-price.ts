import type { CoinData } from "@/lib/types";

export function normalizePaperSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

/** Live Binance mark from market snapshot — never cost basis. */
export function resolvePaperLiveMarkPrice(
  symbol: string,
  marketCoins: CoinData[],
  fallback: number,
): number {
  const base = normalizePaperSymbol(symbol).replace(/USDT$/, "").toLowerCase();
  const coin = marketCoins.find((c) => c.symbol.toLowerCase() === base);
  const mark = coin?.current_price;
  if (mark != null && Number.isFinite(mark) && mark > 0) return mark;
  return fallback;
}
