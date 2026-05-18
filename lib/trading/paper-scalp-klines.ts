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
const KLINE_INTERVAL = "1h";
const DEFAULT_LIMIT = 100;
const FETCH_DELAY_MS = 350;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeKlineSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

function klineSymbolCandidates(symbol: string): string[] {
  const base = normalizeKlineSymbol(symbol);
  return KLINE_SYMBOL_CANDIDATES[base] ?? [base];
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

async function fetchHourlyKlinesForSymbol(
  binanceSymbol: string,
  limit: number,
): Promise<ScalpCandle[]> {
  const url = new URL(BINANCE_KLINES);
  url.searchParams.set("symbol", binanceSymbol);
  url.searchParams.set("interval", KLINE_INTERVAL);
  url.searchParams.set("limit", String(Math.min(1000, Math.max(30, limit))));

  const res = await fetch(url.toString(), {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as unknown[];
  const priceScale = KLINE_TO_BASE_SCALE[binanceSymbol] ?? 1;
  return parseKlineRows(rows, priceScale);
}

/** Sequential 1h kline fetch — avoids Binance IP burst rate limits. */
export async function fetch1hKlines(
  symbol: string,
  limit = DEFAULT_LIMIT,
): Promise<ScalpCandle[]> {
  const base = normalizeKlineSymbol(symbol);
  try {
    for (const candidate of klineSymbolCandidates(base)) {
      const candles = await fetchHourlyKlinesForSymbol(candidate, limit);
      if (candles.length >= 30) {
        if (candidate !== base) {
          console.log(
            `[paper-1h] ${base} via ${candidate} (${candles.length}×1h bars)`,
          );
        }
        return candles;
      }
    }
    return [];
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[BINANCE-FETCH-BLOCKED] fetch1hKlines failed", {
      symbol: base,
      message: err.message,
    });
    return [];
  }
}

/** @deprecated Use fetch1hKlines — kept for imports. */
export const fetch1mKlines = fetch1hKlines;

export async function loadPaperScalpSnapshots(
  symbols: string[],
): Promise<Map<string, Scalp1mSnapshot>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const delayMs = Number(process.env.PAPER_BINANCE_FETCH_DELAY_MS ?? FETCH_DELAY_MS);
  const map = new Map<string, Scalp1mSnapshot>();

  try {
    for (let i = 0; i < unique.length; i++) {
      const symbol = unique[i];
      const candles = await fetch1hKlines(symbol);
      const snap = buildScalp1mSnapshot(symbol, candles);
      if (snap) map.set(symbol, snap);
      if (i < unique.length - 1 && delayMs > 0) {
        await sleep(delayMs);
      }
    }
    return map;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[BINANCE-FETCH-BLOCKED] loadPaperScalpSnapshots failed", {
      message: err.message,
    });
    return map;
  }
}

export async function loadPaperScalpSnapshotsResilient(
  symbols: string[],
  marketCoins: CoinData[],
): Promise<{ snapshots: Map<string, Scalp1mSnapshot>; source: "binance" | "mock" }> {
  try {
    const snapshots = await loadPaperScalpSnapshots(symbols);
    if (snapshots.size > 0) {
      return { snapshots, source: "binance" };
    }
    console.warn("[paper-1h] empty snapshots — using mock hourly bars");
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[BINANCE-FETCH-BLOCKED] resilient loader", {
      message: err.message,
    });
  }

  return {
    snapshots: buildMockScalpSnapshots(symbols, marketCoins),
    source: "mock",
  };
}

export function buildMockScalpSnapshots(
  symbols: string[],
  coins: CoinData[],
): Map<string, Scalp1mSnapshot> {
  const map = new Map<string, Scalp1mSnapshot>();
  const now = Date.now();
  const hourMs = 3_600_000;

  for (const raw of symbols) {
    const sym = normalizeKlineSymbol(raw);
    const base = sym.replace(/USDT$/, "").toLowerCase();
    const coin = coins.find((c) => c.symbol.toLowerCase() === base);
    const anchor = coin?.current_price ?? mockCloseForSymbol(sym);

    const candles: ScalpCandle[] = Array.from({ length: 60 }, (_, i) => {
      const wiggle = 1 + Math.sin(i / 3) * 0.008;
      const close = anchor * wiggle;
      return {
        open: close * 0.998,
        high: close * 1.012,
        low: close * 0.988,
        close,
        closeTime: now - (60 - i) * hourMs,
      };
    });

    const snap = buildScalp1mSnapshot(sym, candles);
    if (snap) map.set(sym, snap);
  }

  return map;
}
