export const BINANCE_KLINES_ENDPOINT =
  "https://api.binance.com/api/v3/klines";

export const KLINE_INTERVAL_15M = "15m";

/** @deprecated Paper scalp now uses 15m — alias for legacy imports. */
export const KLINE_INTERVAL_1H = KLINE_INTERVAL_15M;

export function normalizeKlineSymbol(symbol: string): string {
  const s = String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/\//g, "")
    .replace(/[^A-Z0-9]/g, "");
  if (!s) return "";
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

/** Binance spot kline symbol: 2–20 char base + USDT. */
export function isValidKlineTicker(symbol: string): boolean {
  return /^[A-Z0-9]{2,20}USDT$/.test(symbol);
}

export function sanitizePaperScalpSymbolList(symbols: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of symbols) {
    if (raw == null || raw === undefined) continue;
    const sym = normalizeKlineSymbol(String(raw));
    if (!sym) {
      console.warn("[paper-1h] skip blank ticker in symbol list");
      continue;
    }
    if (!isValidKlineTicker(sym)) {
      console.warn("[paper-1h] skip invalid ticker format", { raw, normalized: sym });
      continue;
    }
    if (seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out;
}

export function buildBinanceKlinesRequestUrl(
  binanceSymbol: string,
  limit: number,
  endpoint = BINANCE_KLINES_ENDPOINT,
  interval = KLINE_INTERVAL_15M,
): string | null {
  const base = String(endpoint ?? "").trim();
  if (!base.startsWith("https://")) {
    console.warn("[paper-1h] skip fetch — invalid klines endpoint", { endpoint: base });
    return null;
  }
  if (!isValidKlineTicker(binanceSymbol)) {
    console.warn("[paper-1h] skip fetch — invalid binance symbol", { binanceSymbol });
    return null;
  }
  try {
    const url = new URL(base);
    url.searchParams.set("symbol", binanceSymbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", String(Math.min(1000, Math.max(30, limit))));
    const href = url.toString();
    if (!href.startsWith("https://") || !href.includes("symbol=")) return null;
    return href;
  } catch (error) {
    console.warn("[paper-1h] skip fetch — malformed klines URL", {
      binanceSymbol,
      endpoint: base,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
