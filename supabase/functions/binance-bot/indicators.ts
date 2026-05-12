// @ts-nocheck
import {
  DEFAULT_BUY_RSI,
  DEFAULT_SELL_RSI,
  EMA_FAST_PERIOD,
  EMA_SLOW_PERIOD,
  RSI_PERIOD,
} from "./constants.ts";
import type { BotSettingsRow, Candle, SignalDecision } from "./types.ts";
import { clamp, toNumber } from "./utils.ts";

const DIVISOR_EPSILON = 1e-12;

function normalizeSmallNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value === 0) return 0;
  const abs = Math.abs(value);
  if (abs >= 1) return Number(value.toFixed(6));
  if (abs >= 0.0001) return Number(value.toFixed(8));
  return Number(value.toPrecision(12));
}

export function calculateEma(prices: number[], period: number): number {
  if (!prices.length) return 0;
  if (prices.length < period) {
    const seed = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    return normalizeSmallNumber(seed);
  }
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
  for (let i = period; i < prices.length; i += 1) {
    ema = prices[i] * multiplier + ema * (1 - multiplier);
  }
  return normalizeSmallNumber(ema);
}

export function calculateRsi(prices: number[], period = RSI_PERIOD): number {
  if (prices.length <= period) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i += 1) {
    const delta = prices[i] - prices[i - 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < prices.length; i += 1) {
    const delta = prices[i] - prices[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;

  const rs = avgGain / Math.max(DIVISOR_EPSILON, avgLoss);
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

export function calculateMacd(prices: number[]) {
  // MACD(12,26,9)
  const ema12 = seriesEma(prices, 12);
  const ema26 = seriesEma(prices, 26);
  const macdSeries = ema12.map((v, i) => v - (ema26[i] ?? 0));
  const signalSeries = seriesEma(macdSeries, 9);
  const macd = macdSeries[macdSeries.length - 1] ?? 0;
  const signal = signalSeries[signalSeries.length - 1] ?? 0;
  const histogram = macd - signal;
  return {
    macd: normalizeSmallNumber(macd),
    signal: normalizeSmallNumber(signal),
    histogram: normalizeSmallNumber(histogram),
  };
}

export function calculateBollingerBands(
  prices: number[],
  window = 20,
  std = 2,
) {
  if (prices.length < window) {
    const fallback = prices[prices.length - 1] ?? 0;
    return { lower: fallback, middle: fallback, upper: fallback };
  }

  const slice = prices.slice(-window);
  const mean = slice.reduce((sum, p) => sum + p, 0) / Math.max(DIVISOR_EPSILON, window);
  const variance = slice.reduce((sum, p) => sum + (p - mean) ** 2, 0) /
    Math.max(DIVISOR_EPSILON, window);
  const deviation = Math.sqrt(variance);

  return {
    lower: mean - std * deviation,
    middle: mean,
    upper: mean + std * deviation,
  };
}

/**
 * Last Wilder ATR(`period`) from OHLC candles (classic true range).
 * Returns 0 if not enough bars.
 */
export function calculateAtrLast(candles: Candle[], period: number): number {
  if (!candles?.length || candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close),
    );
    if (Number.isFinite(tr) && tr >= 0) trs.push(tr);
  }
  if (trs.length < period) return 0;
  let atr = 0;
  for (let i = 0; i < period; i++) atr += trs[i];
  atr /= period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return normalizeSmallNumber(atr);
}

function seriesEma(prices: number[], period: number) {
  if (prices.length === 0) return [];
  const multiplier = 2 / (period + 1);
  const result: number[] = [];
  let ema = prices[0] ?? 0;
  for (let i = 0; i < prices.length; i += 1) {
    if (i === period - 1 && prices.length >= period) {
      ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
    } else if (i > 0) {
      ema = prices[i] * multiplier + ema * (1 - multiplier);
    }
    result.push(ema);
  }
  return result;
}

function hasGreen1mCandle(candles: Candle[] | undefined): boolean {
  const last = candles?.at(-1);
  if (!last) return false;
  return toNumber(last.close, 0) > toNumber(last.open, 0);
}

function hasBullishRsiDivergence(closes: number[], rsi: number): boolean {
  if (closes.length < 4) return false;
  const prevClose = toNumber(closes[closes.length - 2], 0);
  const lastClose = toNumber(closes[closes.length - 1], 0);
  const priorClose = toNumber(closes[closes.length - 3], 0);
  if (!(prevClose > 0) || !(lastClose > 0) || !(priorClose > 0)) return false;
  const priceLowerLow = lastClose < prevClose && prevClose <= priorClose;
  const rsiRecovering = rsi > 0 && lastClose < prevClose && rsi >= 28;
  return priceLowerLow && rsiRecovering;
}

export function decideTechnicalSignal(
  rsi: number,
  emaFast: number,
  emaSlow: number,
  latestPrice: number,
  row: BotSettingsRow,
  candles1m?: Candle[],
): SignalDecision {
  const buyRsi = clamp(toNumber(row.rsi_buy_threshold, DEFAULT_BUY_RSI), 5, 50);
  const sellRsi = clamp(
    toNumber(row.rsi_sell_threshold, DEFAULT_SELL_RSI),
    50,
    95,
  );

  const bullishTrend = emaFast > emaSlow;
  const bearishTrend = emaFast < emaSlow;
  const closes = (candles1m ?? []).map((c) => toNumber(c.close, 0)).filter((c) => c > 0);
  const dipStabilized = hasBullishRsiDivergence(closes, rsi) || hasGreen1mCandle(candles1m);

  if (rsi <= buyRsi && bullishTrend && latestPrice >= emaFast && dipStabilized) return "BUY";
  if (rsi >= sellRsi && bearishTrend && latestPrice <= emaFast) return "SELL";
  return "HOLD";
}

export function computeEmaPair(closes: number[]) {
  return {
    emaFast: calculateEma(closes, EMA_FAST_PERIOD),
    emaSlow: calculateEma(closes, EMA_SLOW_PERIOD),
  };
}

export function decideBbandRsiEntry(
  latestPrice: number,
  rsi: number,
  bbLower: number,
): SignalDecision {
  if (rsi < 30 && latestPrice < bbLower) return "BUY";
  if (rsi > 70) return "SELL";
  return "HOLD";
}

