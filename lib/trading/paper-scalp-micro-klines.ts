import type { CoinData } from "@/lib/types";
import {
  buildScalp1mSnapshot,
  type Scalp1mSnapshot,
  type ScalpCandle,
} from "@/lib/trading/paper-scalp-indicators";
import {
  buildBinanceKlinesRequestUrl,
  isValidKlineTicker,
  KLINE_INTERVAL_1M,
  KLINE_INTERVAL_3M,
  normalizeKlineSymbol,
  sanitizePaperScalpSymbolList,
} from "@/lib/trading/paper-scalp-kline-symbols";
import { resolveMicroScalpInterval } from "@/lib/trading/paper-scalp-engine-mode";
import { parseKlineField } from "@/lib/trading/micro-price";
import type { PaperMarketHarvest } from "@/lib/trading/paper-scalp-klines";

const MICRO_LIMIT = 90;
const FETCH_MS = 4_000;

const KLINE_SYMBOL_CANDIDATES: Record<string, string[]> = {
  PEPEUSDT: ["PEPEUSDT", "1000PEPEUSDT"],
  SHIBUSDT: ["SHIBUSDT", "1000SHIBUSDT"],
};

const KLINE_TO_BASE_SCALE: Record<string, number> = {
  "1000PEPEUSDT": 1 / 1000,
  "1000SHIBUSDT": 1 / 1000,
};

function klineCandidates(symbol: string): string[] {
  const base = normalizeKlineSymbol(symbol);
  return KLINE_SYMBOL_CANDIDATES[base] ?? [base];
}

function parseRows(rows: unknown[], priceScale = 1): ScalpCandle[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const k = row as unknown[];
      return {
        open: parseKlineField(k[1]) * priceScale,
        high: parseKlineField(k[2]) * priceScale,
        low: parseKlineField(k[3]) * priceScale,
        close: parseKlineField(k[4]) * priceScale,
        closeTime: parseKlineField(k[6]),
        volume: parseKlineField(k[5]),
      };
    })
    .filter((c) =>
      [c.open, c.high, c.low, c.close].every((n) => Number.isFinite(n) && n > 0),
    );
}

async function fetchIntervalKlines(
  binanceSymbol: string,
  interval: "1m" | "3m",
  limit: number,
): Promise<ScalpCandle[]> {
  const url = buildBinanceKlinesRequestUrl(
    binanceSymbol,
    limit,
    undefined,
    interval === "3m" ? KLINE_INTERVAL_3M : KLINE_INTERVAL_1M,
  );
  if (!url) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_MS);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!res.ok) return [];
    const rows = (await res.json()) as unknown[];
    const scale = KLINE_TO_BASE_SCALE[binanceSymbol] ?? 1;
    return parseRows(rows, scale);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchMicroKlines(
  symbol: string,
  interval: "1m" | "3m" = resolveMicroScalpInterval(),
): Promise<ScalpCandle[]> {
  const base = normalizeKlineSymbol(symbol);
  if (!isValidKlineTicker(base)) return [];
  for (const candidate of klineCandidates(base)) {
    const candles = await fetchIntervalKlines(candidate, interval, MICRO_LIMIT);
    if (candles.length >= 20) return candles;
  }
  return [];
}

async function loadSymbol(
  symbol: string,
  interval: "1m" | "3m",
): Promise<{ symbol: string; snap: Scalp1mSnapshot | null; candles: ScalpCandle[] }> {
  const candles = await fetchMicroKlines(symbol, interval);
  const snap = buildScalp1mSnapshot(symbol, candles);
  return { symbol: normalizeKlineSymbol(symbol), snap, candles };
}

export type DualMicroHarvest = PaperMarketHarvest & {
  candles1m: Map<string, ScalpCandle[]>;
  candles3m: Map<string, ScalpCandle[]>;
};

async function loadSymbolDual(
  symbol: string,
): Promise<{
  symbol: string;
  snap: Scalp1mSnapshot | null;
  candles1m: ScalpCandle[];
  candles3m: ScalpCandle[];
}> {
  const [c1, c3] = await Promise.all([
    fetchMicroKlines(symbol, "1m"),
    fetchMicroKlines(symbol, "3m"),
  ]);
  const key = normalizeKlineSymbol(symbol);
  const snap = buildScalp1mSnapshot(key, c1.length >= c3.length ? c1 : c3);
  return { symbol: key, snap, candles1m: c1, candles3m: c3 };
}

/** Parallel 1m + 3m harvest — 4s timeout per symbol fetch. */
export async function harvestMicroCandlesParallel(
  symbols: string[],
): Promise<DualMicroHarvest> {
  const unique = sanitizePaperScalpSymbolList(symbols);
  const snapshots = new Map<string, Scalp1mSnapshot>();
  const candles1m = new Map<string, ScalpCandle[]>();
  const candles3m = new Map<string, ScalpCandle[]>();
  const candlesBySymbol = new Map<string, ScalpCandle[]>();

  const rows = await Promise.all(unique.map((s) => loadSymbolDual(s)));
  for (const { symbol, snap, candles1m: a, candles3m: b } of rows) {
    if (a.length > 0) {
      candles1m.set(symbol, a);
      candlesBySymbol.set(symbol, a);
    }
    if (b.length > 0) candles3m.set(symbol, b);
    if (snap) snapshots.set(symbol, snap);
  }

  return {
    snapshots,
    candlesBySymbol,
    candles1m,
    candles3m,
    source: snapshots.size > 0 ? "binance" : "mock",
  };
}

export async function loadMicroScalpMarketHarvest(
  symbols: string[],
): Promise<PaperMarketHarvest> {
  const interval = resolveMicroScalpInterval();
  const unique = sanitizePaperScalpSymbolList(symbols);
  const snapshots = new Map<string, Scalp1mSnapshot>();
  const candlesBySymbol = new Map<string, ScalpCandle[]>();
  const rows = await Promise.all(unique.map((s) => loadSymbol(s, interval)));
  for (const { symbol, snap, candles } of rows) {
    if (candles.length > 0) candlesBySymbol.set(symbol, candles);
    if (snap) snapshots.set(symbol, snap);
  }
  return { snapshots, candlesBySymbol, source: "binance" };
}

export function buildMockMicroHarvest(
  symbols: string[],
  marketCoins: CoinData[],
): PaperMarketHarvest {
  const snapshots = new Map<string, Scalp1mSnapshot>();
  const candlesBySymbol = new Map<string, ScalpCandle[]>();
  for (const sym of symbols) {
    const coin = marketCoins.find(
      (c) => normalizeKlineSymbol(c.symbol) === normalizeKlineSymbol(sym),
    );
    const close = coin?.price ?? 1;
    const candles: ScalpCandle[] = Array.from({ length: 60 }, (_, i) => ({
      open: close,
      high: close * 1.001,
      low: close * 0.999,
      close,
      closeTime: Date.now() - (60 - i) * 60_000,
      volume: 1000 + i * 10,
    }));
    candlesBySymbol.set(sym, candles);
    const snap = buildScalp1mSnapshot(sym, candles);
    if (snap) snapshots.set(sym, snap);
  }
  return { snapshots, candlesBySymbol, source: "mock" };
}
