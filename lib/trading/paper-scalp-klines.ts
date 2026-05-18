import type { CoinData } from "@/lib/types";
import {
  buildScalp1mSnapshot,
  type Scalp1mSnapshot,
  type ScalpCandle,
} from "@/lib/trading/paper-scalp-indicators";

const BINANCE_KLINES = "https://api.binance.com/api/v3/klines";
const DEFAULT_SYMBOLS = ["BTCUSDT", "SOLUSDT", "PEPEUSDT"] as const;

export function resolvePaperScalpSymbols(extra: string[] = []): string[] {
  const raw = (process.env.PAPER_SCALP_SYMBOLS ?? "").trim();
  const fromEnv = raw
    ? raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : [...DEFAULT_SYMBOLS];
  const merged = new Set([...fromEnv, ...extra.map((s) => s.toUpperCase())]);
  return [...merged];
}

function parseKlineRows(rows: unknown[]): ScalpCandle[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const k = row as number[];
      return {
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        closeTime: Number(k[6]),
      };
    })
    .filter((c) =>
      [c.open, c.high, c.low, c.close].every((n) => Number.isFinite(n) && n > 0),
    );
}

export async function fetch1mKlines(
  symbol: string,
  limit = 60,
): Promise<ScalpCandle[]> {
  const sym = symbol.toUpperCase().replace(/\//g, "");
  const url = new URL(BINANCE_KLINES);
  url.searchParams.set("symbol", sym.endsWith("USDT") ? sym : `${sym}USDT`);
  url.searchParams.set("interval", "1m");
  url.searchParams.set("limit", String(Math.min(1000, Math.max(30, limit))));

  try {
    const res = await fetch(url.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as unknown[];
    return parseKlineRows(rows);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[BINANCE-FETCH-BLOCKED] fetch1mKlines failed", {
      symbol: sym,
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
    const close = coin?.current_price ?? 100;

    const candles: ScalpCandle[] = Array.from({ length: 48 }, (_, i) => ({
      open: close,
      high: close * 1.0008,
      low: close * 0.9992,
      close,
      closeTime: now - (48 - i) * 60_000,
    }));

    const snap = buildScalp1mSnapshot(sym, candles);
    if (snap) map.set(sym, snap);
  }

  return map;
}
