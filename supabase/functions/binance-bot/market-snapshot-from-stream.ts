// @ts-nocheck
/** Build `IndicatorSnapshot` from stream-hub cache (no Binance REST in cron prefetch). */

import { ATR_PERIOD } from "./constants.ts";
import type { StreamMarketPayload } from "./market-stream-payload.ts";
import type { Candle, IndicatorSnapshot } from "./types.ts";
import { toNumber } from "./utils.ts";
import {
  calculateAtrLast,
  calculateBollingerBands,
  calculateEma,
  calculateMacd,
  calculateRsi,
  computeEmaPair,
} from "./indicators.ts";
import { computeDailySupportResistance } from "./daily-support-resistance.ts";
import { getRegimeDiagnostics } from "./strategy.ts";
import { computeVolatilityBurstGuard } from "./volatility-burst-predictor.ts";
import {
  applyLatestZeroVolumeCarryForward,
  midPriceFromBidAsk,
  trendFromCloses,
  validateIndicatorsOrThrow,
} from "./market-data-helpers.ts";

function hubCandlesToCandles(rows: Candle[]): Candle[] {
  return rows.map((c) => ({
    openTime: toNumber(c.openTime, 0),
    open: toNumber(c.open, 0),
    high: toNumber(c.high, 0),
    low: toNumber(c.low, 0),
    close: toNumber(c.close, 0),
    volume: toNumber(c.volume, 0),
  }));
}

export function assembleIndicatorSnapshotFromStream(
  payload: StreamMarketPayload,
): IndicatorSnapshot {
  const symbol = String(payload.symbol ?? "").toUpperCase();
  const candles = applyLatestZeroVolumeCarryForward(hubCandlesToCandles(payload.klines["1m"] ?? []));
  const candles15m = hubCandlesToCandles(payload.klines["15m"] ?? []);
  const candles1h = hubCandlesToCandles(payload.klines["1h"] ?? []);
  const candles4h = hubCandlesToCandles(payload.klines["4h"] ?? []);
  const candles5m = hubCandlesToCandles(payload.klines["5m"] ?? []);
  const candles1d = hubCandlesToCandles(payload.klines["1d"] ?? []);
  const closes = candles.map((c) => c.close).filter((p) => p > 0);
  const closes15m = candles15m.map((c) => c.close).filter((p) => p > 0);
  if (closes.length < 200) throw new Error(`Not enough candles for ${symbol} (need >= 200)`);
  if (closes15m.length < 30) throw new Error(`Not enough 15m candles for ${symbol}`);
  if (candles1h.length < 50) throw new Error(`Not enough 1h candles for ${symbol}`);

  const bestBid = toNumber(payload.tick?.bid, 0);
  const bestAsk = toNumber(payload.tick?.ask, 0);
  const bookMid = midPriceFromBidAsk(bestBid, bestAsk);
  const latestPrice = toNumber(payload.tick?.last, 0) ||
    bookMid ||
    toNumber(payload.mini?.last, 0) ||
    closes[closes.length - 1] ||
    0;

  const rsi = calculateRsi(closes);
  const rsi15m = calculateRsi(closes15m);
  const bb = calculateBollingerBands(closes, 20, 2);
  const ema200 = calculateEma(closes, 200);
  const ema50 = calculateEma(closes, 50);
  const { emaFast, emaSlow } = computeEmaPair(closes);
  const macd = calculateMacd(closes);
  validateIndicatorsOrThrow({ symbol, latestPrice, emaFast, emaSlow, ema200 });

  const closes1hTf = candles1h.map((c) => c.close).filter((p) => p > 0);
  const closes4hTf = candles4h.map((c) => c.close).filter((p) => p > 0);
  const closes15mTf = candles15m.map((c) => c.close).filter((p) => p > 0);
  const trend1h = trendFromCloses(closes1hTf, 20);
  const trend4h = trendFromCloses(closes4hTf, 12);
  const trend15m = trendFromCloses(closes15mTf, 14);
  const mtf_aligned = trend1h === "flat" || trend4h === "flat" || trend1h === trend4h;
  const mtf_ltf_aligned = trend15m === "flat" || trend1h === "flat" || trend15m === trend1h;
  const regimeDiag = getRegimeDiagnostics(candles1h.slice(-50));
  const atr14 = calculateAtrLast(candles, ATR_PERIOD);
  const avgVolume1m = Number(
    (candles.slice(-50).reduce((s, c) => s + Math.max(0, c.volume), 0) /
      Math.max(1, Math.min(50, candles.length))).toFixed(6),
  );
  const spreadMid = bookMid ?? 0;
  const spreadBps = spreadMid > 0 && bestAsk >= bestBid
    ? Number((((bestAsk - bestBid) / spreadMid) * 10_000).toFixed(4))
    : null;

  return {
    symbol,
    latestPrice,
    imbalance_ratio: 1,
    candles5: candles.slice(-5),
    candles15: candles.slice(-15),
    candles15m: candles15m.slice(-5),
    candles1h: candles1h.slice(-50),
    candles5m: candles5m.slice(-15),
    candles1d,
    daily_support_resistance: computeDailySupportResistance(candles1d),
    order_book_top10: { bids: [], asks: [] },
    candles4h: candles4h.slice(-15),
    trend_htf: {
      trend_1h: trend1h,
      trend_4h: trend4h,
      mtf_aligned,
      trend_15m: trend15m,
      mtf_ltf_aligned,
      mtf_effective_ok: mtf_aligned || mtf_ltf_aligned,
    },
    marketRegime: regimeDiag.regime,
    adx14: regimeDiag.adx14,
    atr14,
    dayLow24h: toNumber(payload.mini?.low, latestPrice),
    volume24hQuote: toNumber(payload.mini?.quoteVolume, NaN) || null,
    volume24hBase: toNumber(payload.mini?.baseVolume, NaN) || null,
    spreadBps,
    avgVolume1m,
    rsi,
    rsi15m,
    bbLower: bb.lower,
    bbMiddle: bb.middle,
    bbUpper: bb.upper,
    ema200,
    ema50,
    emaFast,
    emaSlow,
    macd,
    volBurstWidenMult: computeVolatilityBurstGuard(candles).widenMult,
    volBurstMeta: computeVolatilityBurstGuard(candles).meta,
  };
}
