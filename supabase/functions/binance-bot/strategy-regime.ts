// @ts-nocheck
import type { Candle, MarketRegime } from "./types.ts";

const ADX_PERIOD = 14;
const BB_WIDTH_PERIOD = 20;
const RANGING_BB_WIDTH_THRESHOLD = 0.03;

function sumSlice(values: number[], start: number, length: number) {
  return values.slice(start, start + length).reduce((sum, value) => sum + value, 0);
}

function calculateBbWidth(candles: Candle[], period: number) {
  const closes = candles.map((c) => c.close).filter((v) => v > 0);
  if (closes.length < period) return 0;
  const window = closes.slice(-period);
  const mean = window.reduce((sum, value) => sum + value, 0) / period;
  if (!Number.isFinite(mean) || mean <= 0) return 0;
  const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    period;
  const deviation = Math.sqrt(variance);
  const upper = mean + 2 * deviation;
  const lower = mean - 2 * deviation;
  const width = (upper - lower) / mean;
  return Number(width.toFixed(6));
}

/** Wilder-style ADX(period) on OHLC candles (last bar). */
export function calculateAdx(candles: Candle[], period: number): number {
  if (candles.length < period + 2) return 0;
  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];

  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const prev = candles[i - 1];
    const upMove = current.high - prev.high;
    const downMove = prev.low - current.low;
    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close),
    );
    trs.push(tr);
    plusDMs.push(plusDM);
    minusDMs.push(minusDM);
  }

  let atr = sumSlice(trs, 0, period);
  let plusDM = sumSlice(plusDMs, 0, period);
  let minusDM = sumSlice(minusDMs, 0, period);
  if (atr <= 0) return 0;

  const dxValues: number[] = [];
  for (let i = period; i < trs.length; i += 1) {
    if (i > period) {
      atr = atr - atr / period + trs[i];
      plusDM = plusDM - plusDM / period + plusDMs[i];
      minusDM = minusDM - minusDM / period + minusDMs[i];
    }
    const plusDI = (100 * plusDM) / atr;
    const minusDI = (100 * minusDM) / atr;
    const denom = plusDI + minusDI;
    const dx = denom > 0 ? (100 * Math.abs(plusDI - minusDI)) / denom : 0;
    dxValues.push(dx);
  }
  if (dxValues.length === 0) return 0;
  const adx = dxValues.reduce((sum, value) => sum + value, 0) / dxValues.length;
  return Number(adx.toFixed(2));
}

/** ADX + BB width + regime in one pass (used by market snapshot + audit). */
export function getRegimeDiagnostics(candles1h: Candle[]): {
  regime: MarketRegime;
  adx14: number;
  bbWidth: number;
} {
  if (!candles1h || candles1h.length < BB_WIDTH_PERIOD + 2) {
    return { regime: "NEUTRAL", adx14: 0, bbWidth: 0 };
  }
  const adx14 = calculateAdx(candles1h, ADX_PERIOD);
  const bbWidth = calculateBbWidth(candles1h, BB_WIDTH_PERIOD);
  let regime: MarketRegime = "NEUTRAL";
  if (adx14 > 25) regime = "TRENDING";
  else if (adx14 < 20 && bbWidth < RANGING_BB_WIDTH_THRESHOLD) regime = "RANGING";
  return { regime, adx14, bbWidth };
}

export function getMarketRegime(candles1h: Candle[]): MarketRegime {
  return getRegimeDiagnostics(candles1h).regime;
}
