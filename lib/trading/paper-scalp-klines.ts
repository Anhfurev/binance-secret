import type { CoinData } from "@/lib/types";
import {
  mockCloseForSymbol,
  parseKlineField,
} from "@/lib/trading/micro-price";
import {
  buildScalp1mSnapshot,
  type Scalp1mSnapshot,
  type ScalpCandle,
} from "@/lib/trading/paper-scalp-indicators";
import {
  buildBinanceKlinesRequestUrl,
  isValidKlineTicker,
  KLINE_INTERVAL_15M,
  normalizeKlineSymbol,
  sanitizePaperScalpSymbolList,
} from "@/lib/trading/paper-scalp-kline-symbols";
import {
  DEFAULT_PAPER_WATCH_SYMBOLS,
  resolvePaperScalpSymbols,
} from "@/lib/trading/paper-scalp-settings";

export { resolvePaperScalpSymbols };

const DEFAULT_SYMBOLS = DEFAULT_PAPER_WATCH_SYMBOLS;
const DEFAULT_LIMIT = 100;
const PARALLEL_FETCH_TIMEOUT_MS = 5_000;

const KLINE_SYMBOL_CANDIDATES: Record<string, string[]> = {
  PEPEUSDT: ["PEPEUSDT", "1000PEPEUSDT"],
  SHIBUSDT: ["SHIBUSDT", "1000SHIBUSDT"],
  FLOKIUSDT: ["FLOKIUSDT", "1000FLOKIUSDT"],
  BONKUSDT: ["BONKUSDT", "1000BONKUSDT"],
};

const KLINE_TO_BASE_SCALE: Record<string, number> = {
  "1000PEPEUSDT": 1 / 1000,
  "1000SHIBUSDT": 1 / 1000,
  "1000FLOKIUSDT": 1 / 1000,
  "1000BONKUSDT": 1 / 1000,
};

function klineSymbolCandidates(symbol: string): string[] {
  const base = normalizeKlineSymbol(symbol);
  return KLINE_SYMBOL_CANDIDATES[base] ?? [base];
}

function parseKlineRows(rows: unknown[], priceScale = 1): ScalpCandle[] {
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

async function fetch15mKlinesForSymbol(
  binanceSymbol: string,
  limit: number,
): Promise<ScalpCandle[]> {
  const url = buildBinanceKlinesRequestUrl(binanceSymbol, limit);
  if (!url) return [];

  const controller = new AbortController();
  const timeoutMs = PARALLEL_FETCH_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn("[paper-15m] binance klines HTTP error", {
        symbol: binanceSymbol,
        status: res.status,
        url,
      });
      return [];
    }
    const rows = (await res.json()) as unknown[];
    const priceScale = KLINE_TO_BASE_SCALE[binanceSymbol] ?? 1;
    return parseKlineRows(rows, priceScale);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.warn("[BINANCE-FETCH-SKIP] Skipping malformed or failed ticker", {
      symbol: binanceSymbol,
      url,
      message: err.message,
      code:
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code)
          : undefined,
    });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Single-symbol 15m kline fetch (PEPE/1000PEPE fallback inside symbol). */
export async function fetch15mKlines(
  symbol: string,
  limit = DEFAULT_LIMIT,
): Promise<ScalpCandle[]> {
  const base = normalizeKlineSymbol(symbol);
  if (!isValidKlineTicker(base)) {
    console.warn("[paper-15m] fetch15mKlines skipped — invalid ticker", { symbol });
    return [];
  }
  try {
    for (const candidate of klineSymbolCandidates(base)) {
      if (!isValidKlineTicker(candidate)) continue;
      const candles = await fetch15mKlinesForSymbol(candidate, limit);
      if (candles.length >= 30) {
        if (candidate !== base) {
          console.log(
            `[paper-15m] ${base} via ${candidate} (${candles.length}×15m bars)`,
          );
        }
        return candles;
      }
    }
    return [];
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.warn("[BINANCE-FETCH-SKIP] Skipping malformed ticker", {
      symbol: base,
      message: err.message,
    });
    return [];
  }
}

/** @deprecated Use fetch15mKlines — legacy alias. */
export const fetch1hKlines = fetch15mKlines;
export const fetch1mKlines = fetch15mKlines;

export type PaperMarketHarvest = {
  snapshots: Map<string, Scalp1mSnapshot>;
  candlesBySymbol: Map<string, ScalpCandle[]>;
  source: "binance" | "mock";
};

async function loadSnapshotForSymbol(
  symbol: string,
): Promise<{
  symbol: string;
  snap: Scalp1mSnapshot | null;
  candles: ScalpCandle[];
}> {
  try {
    const candles = await fetch15mKlines(symbol);
    const snap = buildScalp1mSnapshot(symbol, candles);
    if (!snap) {
      console.warn("[paper-15m] no snapshot built", {
        symbol,
        candles: candles.length,
      });
    }
    return { symbol, snap, candles };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.warn("[BINANCE-FETCH-SKIP] parallel symbol error — continuing", {
      symbol,
      message: err.message,
    });
    return { symbol, snap: null, candles: [] };
  }
}

/** Parallel 15m harvest — snapshots + raw candles for VWAP/RVOL. */
export async function loadPaperScalpMarketHarvest(
  symbols: unknown[] | string[],
): Promise<PaperMarketHarvest> {
  const cleaned = symbols.filter(
    (s): s is string => s != null && String(s).trim() !== "",
  );
  const unique = sanitizePaperScalpSymbolList(
    cleaned.map((s) => String(s)),
  );
  const snapshots = new Map<string, Scalp1mSnapshot>();
  const candlesBySymbol = new Map<string, ScalpCandle[]>();
  const startedAt = performance.now();

  console.log(
    `[paper-15m] parallel kline scan: ${unique.length} symbol(s) [${unique.join(", ")}]`,
  );

  const rows = await Promise.all(unique.map((symbol) => loadSnapshotForSymbol(symbol)));
  for (const { symbol, snap, candles } of rows) {
    if (candles.length > 0) candlesBySymbol.set(symbol, candles);
    if (snap) snapshots.set(symbol, snap);
  }

  const durationMs = Number((performance.now() - startedAt).toFixed(1));
  console.log(
    `[paper-15m] kline scan done: ${snapshots.size}/${unique.length} snapshots in ${durationMs}ms`,
  );
  return { snapshots, candlesBySymbol, source: "binance" };
}

export async function loadPaperScalpSnapshots(
  symbols: unknown[] | string[],
): Promise<Map<string, Scalp1mSnapshot>> {
  const harvest = await loadPaperScalpMarketHarvest(symbols);
  return harvest.snapshots;
}

export async function loadPaperScalpSnapshotsResilient(
  symbols: string[],
  marketCoins: CoinData[],
): Promise<PaperMarketHarvest> {
  try {
    const harvest = await loadPaperScalpMarketHarvest(symbols);
    if (harvest.snapshots.size > 0) {
      return harvest;
    }
    console.warn("[paper-15m] empty snapshots — using mock 15m bars");
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[BINANCE-FETCH-BLOCKED] resilient loader", {
      message: err.message,
    });
  }

  const snapshots = buildMockScalpSnapshots(symbols, marketCoins);
  const candlesBySymbol = new Map<string, ScalpCandle[]>();
  return { snapshots, candlesBySymbol, source: "mock" };
}

export function buildMockScalpSnapshots(
  symbols: string[],
  coins: CoinData[],
): Map<string, Scalp1mSnapshot> {
  const map = new Map<string, Scalp1mSnapshot>();
  const now = Date.now();
  const barMs = 15 * 60_000;

  for (const raw of symbols) {
    const sym = normalizeKlineSymbol(raw);
    const base = sym.replace(/USDT$/, "").toLowerCase();
    const coin = coins.find((c) => c.symbol.toLowerCase() === base);
    const anchor = coin?.current_price ?? mockCloseForSymbol(sym);

    const candles: ScalpCandle[] = Array.from({ length: 96 }, (_, i) => {
      const wiggle = 1 + Math.sin(i / 3) * 0.008;
      const close = anchor * wiggle;
      return {
        open: close * 0.998,
        high: close * 1.012,
        low: close * 0.988,
        close,
        closeTime: now - (96 - i) * barMs,
        volume: 1_000_000 + i * 10_000,
      };
    });

    const snap = buildScalp1mSnapshot(sym, candles);
    if (snap) map.set(sym, snap);
  }

  return map;
}
