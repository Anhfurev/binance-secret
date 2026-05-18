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
  normalizeKlineSymbol,
  sanitizePaperScalpSymbolList,
} from "@/lib/trading/paper-scalp-kline-symbols";
import { DEFAULT_PAPER_WATCH_SYMBOLS } from "@/lib/trading/paper-scalp-settings";

const DEFAULT_SYMBOLS = DEFAULT_PAPER_WATCH_SYMBOLS;
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

function klineSymbolCandidates(symbol: string): string[] {
  const base = normalizeKlineSymbol(symbol);
  return KLINE_SYMBOL_CANDIDATES[base] ?? [base];
}

export function resolvePaperScalpSymbols(
  extra: string[] = [],
  workspaceSymbols: string[] = [],
): string[] {
  const raw = (process.env.PAPER_SCALP_SYMBOLS ?? "").trim();
  const fromEnv = raw
    ? raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : [];
  const base =
    workspaceSymbols.length > 0
      ? workspaceSymbols
      : fromEnv.length > 0
        ? fromEnv
        : [...DEFAULT_SYMBOLS];
  return sanitizePaperScalpSymbolList([
    ...base.map((s) => normalizeKlineSymbol(s)),
    ...extra.map((s) => normalizeKlineSymbol(s)),
  ]);
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
  const url = buildBinanceKlinesRequestUrl(binanceSymbol, limit);
  if (!url) return [];

  const controller = new AbortController();
  const timeoutMs = 20_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn("[paper-1h] binance klines HTTP error", {
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
    console.warn("[paper-1h] binance klines fetch failed — skipping symbol", {
      symbol: binanceSymbol,
      url,
      message: err.message,
      cause: err.cause,
    });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Sequential 1h kline fetch — avoids Binance IP burst rate limits. */
export async function fetch1hKlines(
  symbol: string,
  limit = DEFAULT_LIMIT,
): Promise<ScalpCandle[]> {
  const base = normalizeKlineSymbol(symbol);
  if (!isValidKlineTicker(base)) {
    console.warn("[paper-1h] fetch1hKlines skipped — invalid ticker", { symbol });
    return [];
  }
  try {
    for (const candidate of klineSymbolCandidates(base)) {
      if (!isValidKlineTicker(candidate)) continue;
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
  const unique = sanitizePaperScalpSymbolList(symbols);
  const delayMs = Number(process.env.PAPER_BINANCE_FETCH_DELAY_MS ?? FETCH_DELAY_MS);
  const map = new Map<string, Scalp1mSnapshot>();

  console.log(
    `[paper-1h] sequential kline scan: ${unique.length} symbol(s) [${unique.join(", ")}]`,
  );

  for (let i = 0; i < unique.length; i++) {
    const symbol = unique[i];
    try {
      const candles = await fetch1hKlines(symbol);
      const snap = buildScalp1mSnapshot(symbol, candles);
      if (snap) {
        map.set(symbol, snap);
      } else {
        console.warn("[paper-1h] no 1h snapshot built", {
          symbol,
          candles: candles.length,
        });
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.warn("[paper-1h] symbol loop error — continuing", {
        symbol,
        message: err.message,
      });
    }
    if (i < unique.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  console.log(
    `[paper-1h] kline scan done: ${map.size}/${unique.length} snapshots loaded`,
  );
  return map;
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
