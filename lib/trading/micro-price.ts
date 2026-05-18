/** Sub-cent price parsing, indicator scaling, and log formatting (PEPE, SHIB, etc.). */

export function parseKlineField(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const n = Number.parseFloat(String(raw ?? "").trim());
  return Number.isFinite(n) ? n : NaN;
}

/** Scale tiny prices up for stable EMA/ATR floating-point math; divide results back. */
export function priceIndicatorScale(referencePrice: number): number {
  const p = Math.abs(referencePrice);
  if (!Number.isFinite(p) || p === 0) return 1;
  if (p >= 1) return 1;
  if (p >= 0.01) return 100;
  if (p >= 0.0001) return 10_000;
  if (p >= 0.000001) return 1_000_000;
  return 100_000_000;
}

export function scaleOhlc<T extends { open: number; high: number; low: number; close: number }>(
  candles: T[],
  scale: number,
): T[] {
  if (scale === 1) return candles;
  return candles.map((c) => ({
    ...c,
    open: c.open * scale,
    high: c.high * scale,
    low: c.low * scale,
    close: c.close * scale,
  }));
}

export function formatMicroPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const p = Math.abs(value);
  if (p === 0) return "0";
  if (p >= 1000) return value.toFixed(2);
  if (p >= 1) return value.toFixed(4);
  if (p >= 0.01) return value.toFixed(6);
  if (p >= 0.0001) return value.toFixed(8);
  return value.toFixed(12).replace(/\.?0+$/, "");
}

export function mockCloseForSymbol(symbol: string, fallback = 100): number {
  const sym = symbol.toUpperCase();
  if (sym.includes("PEPE")) return 0.0000145;
  if (sym.includes("SHIB")) return 0.000024;
  if (sym.includes("FLOKI")) return 0.00018;
  if (sym.includes("BONK")) return 0.000025;
  return fallback;
}
