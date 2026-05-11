// @ts-nocheck
import ccxt from "ccxt";
import type { Candle } from "./types.ts";
import { toNumber } from "./utils.ts";
import {
  calculateEma,
} from "./indicators.ts";

const INDICATOR_ZERO_EPSILON = 0;

export function applyLatestZeroVolumeCarryForward(candles: Candle[]): Candle[] {
  if (!Array.isArray(candles) || candles.length < 2) return candles;
  const patched = [...candles];
  const latest = patched[patched.length - 1];
  if (!latest || !Number.isFinite(latest.volume) || latest.volume !== 0) {
    return patched;
  }
  const previous = patched[patched.length - 2];
  if (!previous || !Number.isFinite(previous.close) || previous.close <= 0) {
    return patched;
  }
  const lastThreeVolumes = patched
    .slice(Math.max(0, patched.length - 4), patched.length - 1)
    .map((c) => toNumber(c?.volume, 0))
    .filter((v) => Number.isFinite(v) && v >= 0);
  const avgLastThreeVolume = lastThreeVolumes.length
    ? lastThreeVolumes.reduce((sum, v) => sum + v, 0) / lastThreeVolumes.length
    : 0;
  patched[patched.length - 1] = {
    ...latest,
    open: previous.close,
    high: Math.max(previous.close, latest.high, latest.low, latest.close),
    low: Math.min(previous.close, latest.high, latest.low, latest.close),
    close: previous.close,
    volume: Number(avgLastThreeVolume.toFixed(12)),
  };
  return patched;
}

export function validateIndicatorsOrThrow(params: {
  symbol: string;
  latestPrice: number;
  emaFast: number;
  emaSlow: number;
  ema200: number;
}) {
  const { symbol, latestPrice, emaFast, emaSlow, ema200 } = params;
  const checks = [
    { key: "latestPrice", value: latestPrice },
    { key: "emaFast", value: emaFast },
    { key: "emaSlow", value: emaSlow },
    { key: "ema200", value: ema200 },
  ];
  const bad = checks.find((c) => !Number.isFinite(c.value) || c.value <= INDICATOR_ZERO_EPSILON);
  if (bad) {
    throw new Error(`CRITICAL_INDICATOR_ZERO:${symbol}:${bad.key}`);
  }
}

export function trendFromCloses(
  closes: number[],
  emaPeriod: number,
): "bull" | "bear" | "flat" {
  if (closes.length < Math.max(emaPeriod + 2, 8)) return "flat";
  const p = Math.min(emaPeriod, closes.length - 1);
  const ema = calculateEma(closes, p);
  const c = closes[closes.length - 1];
  const tol = Math.max(c * 0.0005, ema * 0.0005);
  if (c > ema + tol) return "bull";
  if (c < ema - tol) return "bear";
  return "flat";
}

export function normalizeCcxtTimeframe(timeframe: string) {
  if (!timeframe) return "1m";
  return timeframe;
}

export async function resolveLatestPrice(params: {
  exchange: InstanceType<typeof ccxt.binance>;
  ccxtSymbol: string;
  tickerLast: unknown;
  fallbackClose: number;
  streamSymbol?: string;
  signal?: AbortSignal;
}) {
  const { exchange, ccxtSymbol, tickerLast, fallbackClose, streamSymbol, signal } = params;
  if (streamSymbol) {
    const { fetchStreamTickSnapshot } = await import("./stream-tick-snapshot.ts");
    const streamTick = await fetchStreamTickSnapshot(streamSymbol, signal);
    if (streamTick?.last > 0) return streamTick.last;
  }
  const fromTicker = toNumber(tickerLast, 0);
  if (fromTicker > 0) return fromTicker;

  const fromRecentClose = toNumber(fallbackClose, 0);
  if (fromRecentClose > 0) return fromRecentClose;

  const lastCandle = await exchange.fetchOHLCV(ccxtSymbol, "1m", undefined, 1);
  const lastClose = toNumber(lastCandle?.[0]?.[4], 0);
  return lastClose > 0 ? lastClose : 0;
}
