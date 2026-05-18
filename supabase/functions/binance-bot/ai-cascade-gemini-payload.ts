// @ts-nocheck
import type { Candle, IndicatorSnapshot } from "./types.ts";
import { computeDailySupportResistance } from "./daily-support-resistance.ts";
import { tailCandles } from "./ai-payload-slim.ts";

const CASCADE_BAR_COUNT = 15;

export { GEMINI_CASCADE_SCANNER_SYSTEM } from "./gemini-prompt-config.ts";

export type CascadeOhlcvBar = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function candleToOhlcvBar(c: Candle): CascadeOhlcvBar {
  return {
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume),
  };
}

export function buildCascadeGeminiPayload(
  snapshot: IndicatorSnapshot,
  symbol: string,
): Record<string, unknown> {
  const candles5m = tailCandles(snapshot.candles5m ?? [], CASCADE_BAR_COUNT);
  const candles1h = tailCandles(snapshot.candles1h ?? [], CASCADE_BAR_COUNT);
  const dailySr = snapshot.daily_support_resistance ??
    computeDailySupportResistance(snapshot.candles1d ?? []);
  return {
    symbol: String(symbol).toUpperCase(),
    latestPrice: snapshot.latestPrice,
    rsi: snapshot.rsi,
    marketRegime: snapshot.marketRegime,
    candles_5m: candles5m.map(candleToOhlcvBar),
    candles_1h: candles1h.map(candleToOhlcvBar),
    daily_support_resistance: dailySr,
  };
}
