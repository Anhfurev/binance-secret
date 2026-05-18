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

const BINANCE_KLINES = "https://api.binance.com/api/v3/klines";
const DEFAULT_SYMBOLS = ["BTCUSDT", "SOLUSDT", "PEPEUSDT"] as const;

/** Binance spot aliases (e.g. 1000PEPEUSDT quotes per 1000 tokens). */
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

function normalizeKlineSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

function klineSymbolCandidates(symbol: string): string[] {
  const base = normalizeKlineSymbol(symbol);
  const listed = KLINE_SYMBOL_CANDIDATES[base];
  if (listed) return listed;
  return [base];
}

export function resolvePaperScalpSymbols(extra: string[] = []): string[] {
  const raw = (process.env.PAPER_SCALP_SYMBOLS ?? "").trim();
  const fromEnv = raw
    ? raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : [...DEFAULT_SYMBOLS];
  const merged = new Set([...fromEnv, ...extra.map((s) => s.toUpperCase())]);
  return [...merged];
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
      };
    })
    .filter((c) =>
      [c.open, c.high, c.low, c.close].every((n) => Number.isFinite(n) && n > 0),
    );
}

async function fetch1mKlinesForSymbol(
  binanceSymbol: string,
  limit: number,
): Promise<ScalpCandle[]> {
  const url = new URL(BINANCE_KLINES);
  url.searchParams.set("symbol", binanceSymbol);
  url.searchParams.set("interval", "1m");
  url.searchParams.set("limit", String(Math.min(1000, Math.max(30, limit))));

  const res = await fetch(url.toString(), {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as unknown[];
  const priceScale = KLINE_TO_BASE_SCALE[binanceSymbol] ?? 1;
  return parseKlineRows(rows, priceScale);
}

export async function fetch1mKlines(
  symbol: string,
  limit = 60,
): Promise<ScalpCandle[]> {
  const base = normalizeKlineSymbol(symbol);

  try {
    for (const candidate of klineSymbolCandidates(base)) {
      const candles = await fetch1mKlinesForSymbol(candidate, limit);
      if (candles.length >= 25) {
        if (candidate !== base) {
          console.log(
            `[paper-scalp] klines ${base} via Binance symbol ${candidate} (${candles.length} bars)`,
          );
        }
        return candles;
      }
    }
    return [];
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[BINANCE-FETCH-BLOCKED] fetch1mKlines failed", {
      symbol: base,
      message: err.message,
      stack: err.stack,
      cause: err.cause,
    });
    return [];
  }
}

export async function loadPaperScalpSnapshots(
  symbols: string[],
): Promise<Map<string, Scalp1mSnapshot>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
  try {
    const results = await Promise.all(
      unique.map(async (symbol) => {
        const candles = await fetch1mKlines(symbol);
        const snap = buildScalp1mSnapshot(symbol, candles);
        return { symbol, snap };
      }),
    );

    const map = new Map<string, Scalp1mSnapshot>();
    for (const { symbol, snap } of results) {
      if (snap) map.set(symbol, snap);
    }
    return map;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[BINANCE-FETCH-BLOCKED] loadPaperScalpSnapshots failed", {
      message: err.message,
      stack: err.stack,
      cause: err.cause,
    });
    return new Map();
  }
}

/** Binance HTTPS with mock fallback — never throws to the route handler. */
export async function loadPaperScalpSnapshotsResilient(
  symbols: string[],
  marketCoins: CoinData[],
): Promise<{ snapshots: Map<string, Scalp1mSnapshot>; source: "binance" | "mock" }> {
  try {
    const snapshots = await loadPaperScalpSnapshots(symbols);
    if (snapshots.size > 0) {
      return { snapshots, source: "binance" };
    }
    console.warn(
      "[BINANCE-FETCH-BLOCKED] empty kline snapshots — using buildMockScalpSnapshots()",
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[BINANCE-FETCH-BLOCKED] resilient loader caught", {
      message: err.message,
      stack: err.stack,
      cause: err.cause,
    });
  }

  return {
    snapshots: buildMockScalpSnapshots(symbols, marketCoins),
    source: "mock",
  };
}

/** Network-free fallback when Binance klines are unavailable on the server. */
export function buildMockScalpSnapshots(
  symbols: string[],
  coins: CoinData[],
): Map<string, Scalp1mSnapshot> {
  const map = new Map<string, Scalp1mSnapshot>();
  const now = Date.now();

  for (const raw of symbols) {
    const symbol = raw.toUpperCase().replace(/\//g, "");
    const sym = symbol.endsWith("USDT") ? symbol : `${symbol}USDT`;
    const base = sym.replace(/USDT$/, "").toLowerCase();
    const coin = coins.find((c) => c.symbol.toLowerCase() === base);
    const anchor = coin?.current_price ?? mockCloseForSymbol(sym);

    const candles: ScalpCandle[] = Array.from({ length: 48 }, (_, i) => {
      const wiggle = 1 + Math.sin(i / 4) * 0.0015;
      const close = anchor * wiggle;
      return {
        open: close * 0.9999,
        high: close * 1.001,
        low: close * 0.999,
        close,
        closeTime: now - (48 - i) * 60_000,
      };
    });

    const snap = buildScalp1mSnapshot(sym, candles);
    if (snap) map.set(sym, snap);
  }

  return map;
}
