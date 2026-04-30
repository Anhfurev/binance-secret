// @ts-nocheck
/**
 * Regime filter: ADX/BB-based state comes from `getRegimeDiagnostics` (1h candles).
 * RANGING (ADX < 20 + tight BB): prefer mean-reversion entries — avoid trend-chasing longs.
 */
import type { MarketRegime } from "./types.ts";

export { getRegimeDiagnostics } from "./strategy.ts";

export const ADX_TREND_THRESHOLD = 25;
export const ADX_RANGE_THRESHOLD = 20;

export type MeanReversionGateInput = {
  regime: MarketRegime;
  rsi: number;
  latestPrice: number;
  bbLower: number;
};

/** Long dip / grid-style buy context: oversold RSI or price at lower Bollinger band. */
export function passesMeanReversionBuyGate(input: MeanReversionGateInput): boolean {
  const { regime, rsi, latestPrice, bbLower } = input;
  if (regime !== "RANGING") return true;
  const oversold = Number.isFinite(rsi) && rsi < 40;
  const deepOversold = Number.isFinite(rsi) && rsi < 32;
  const nearLowerBand =
    Number.isFinite(bbLower) &&
    bbLower > 0 &&
    Number.isFinite(latestPrice) &&
    latestPrice <= bbLower * 1.012;
  return deepOversold || oversold || nearLowerBand;
}
