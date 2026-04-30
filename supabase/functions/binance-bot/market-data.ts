// @ts-nocheck
import ccxt from "ccxt";
import { ATR_PERIOD, KLINE_INTERVAL, KLINE_LIMIT } from "./constants.ts";
import type { Candle, IndicatorSnapshot } from "./types.ts";
import { formatUnknownError, toNumber } from "./utils.ts";
import {
  calculateAtrLast,
  calculateBollingerBands,
  calculateEma,
  calculateMacd,
  calculateRsi,
  computeEmaPair,
} from "./indicators.ts";
import { toCcxtSymbol } from "./exchange-client.ts";
import { sanitizeOhlcvCandles } from "./ohlcv-sanitizer.ts";
import { getRegimeDiagnostics } from "./strategy.ts";
import { computeVolatilityBurstGuard } from "./volatility-burst-predictor.ts";
import { botError } from "./bot-debug.ts";

let sharedPublicBinance: InstanceType<typeof ccxt.binance> | null = null;

function getSharedPublicBinance(): InstanceType<typeof ccxt.binance> {
  if (!sharedPublicBinance) {
    sharedPublicBinance = new ccxt.binance({ enableRateLimit: true });
  }
  return sharedPublicBinance;
}

const INDICATOR_ZERO_EPSILON = 0;

function applyLatestZeroVolumeCarryForward(candles: Candle[]): Candle[] {
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

function validateIndicatorsOrThrow(params: {
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

export async function fetchIndicatorSnapshotFromMarket(
  symbol: string,
  signal?: AbortSignal,
): Promise<IndicatorSnapshot> {
  try {
  if (signal?.aborted) {
    throw new Error(`CYCLE_ABORTED:${symbol}`);
  }
  const exchange = getSharedPublicBinance();
  if (signal) {
    // Respect outer cycle abort by bounding CCXT request timeout.
    exchange.timeout = Math.min(exchange.timeout ?? 10000, 8_000);
  }
  const ccxtSymbol = toCcxtSymbol(symbol);
  const ohlcvLimit = Math.max(KLINE_LIMIT, 220);
  const [
    ohlcv1m,
    ohlcv15m,
    ohlcv1h,
    ohlcv4h,
    orderBook,
    ticker,
  ] = await Promise.all([
    exchange.fetchOHLCV(
      ccxtSymbol,
      normalizeCcxtTimeframe(KLINE_INTERVAL),
      undefined,
      ohlcvLimit,
    ),
    exchange.fetchOHLCV(
      ccxtSymbol,
      "15m",
      undefined,
      Math.max(100, Math.floor(ohlcvLimit / 2)),
    ),
    exchange.fetchOHLCV(
      ccxtSymbol,
      "1h",
      undefined,
      80,
    ),
    exchange.fetchOHLCV(
      ccxtSymbol,
      "4h",
      undefined,
      48,
    ),
    exchange.fetchOrderBook(ccxtSymbol, 5),
    exchange.fetchTicker(ccxtSymbol),
  ]);
  if (signal?.aborted) throw new Error(`CYCLE_ABORTED:${symbol}`);

  const candles = applyLatestZeroVolumeCarryForward(
    sanitizeOhlcvCandles(ohlcv1m as Array<Array<number | string | null | undefined>>),
  );
  const candles15m = sanitizeOhlcvCandles(
    ohlcv15m as Array<Array<number | string | null | undefined>>,
  );
  const candles1h = sanitizeOhlcvCandles(ohlcv1h as Array<Array<number | string | null | undefined>>);
  const candles4h = sanitizeOhlcvCandles(ohlcv4h as Array<Array<number | string | null | undefined>>);

  const closes = candles.map((c) => c.close).filter((p) => p > 0);
  const closes15m = candles15m.map((c) => c.close).filter((p) => p > 0);
  if (closes.length < 200) {
    throw new Error(`Not enough candles for ${symbol} (need >= 200)`);
  }
  if (closes15m.length < 30) {
    throw new Error(`Not enough 15m candles for ${symbol} (need >= 30)`);
  }
  if (candles1h.length < 50) {
    throw new Error(`Not enough 1h candles for ${symbol} (need >= 50)`);
  }

  const latestPrice = await resolveLatestPrice({
    exchange,
    ccxtSymbol,
    tickerLast: ticker?.last,
    fallbackClose: closes[closes.length - 1] ?? 0,
  });
  const rsi = calculateRsi(closes);
  const rsi15m = calculateRsi(closes15m);
  const bb = calculateBollingerBands(closes, 20, 2);
  const ema200 = calculateEma(closes, 200);
  const ema50 = calculateEma(closes, 50);
  const { emaFast, emaSlow } = computeEmaPair(closes);
  const macd = calculateMacd(closes);
  validateIndicatorsOrThrow({
    symbol,
    latestPrice,
    emaFast,
    emaSlow,
    ema200,
  });
  const candles5 = candles.slice(-5);
  const candles15 = candles.slice(-15);
  const candles15mTail = candles15m.slice(-5);
  const candles1hTail = candles1h.slice(-50);
  const candles4hTail = candles4h.slice(-15);
  const closes1hTf = candles1h.map((c) => c.close).filter((p) => p > 0);
  const closes4hTf = candles4h.map((c) => c.close).filter((p) => p > 0);
  const closes15mTf = candles15m.map((c) => c.close).filter((p) => p > 0);
  const trend1h = trendFromCloses(closes1hTf, 20);
  const trend4h = trendFromCloses(closes4hTf, 12);
  const trend15m = trendFromCloses(closes15mTf, 14);
  const mtf_aligned =
    trend1h === "flat" ||
    trend4h === "flat" ||
    trend1h === trend4h;
  const mtf_ltf_aligned =
    trend15m === "flat" ||
    trend1h === "flat" ||
    trend15m === trend1h;
  const mtf_effective_ok = mtf_aligned || mtf_ltf_aligned;
  const regimeDiag = getRegimeDiagnostics(candles1hTail);
  const marketRegime = regimeDiag.regime;
  const adx14 = regimeDiag.adx14;
  const atr14 = calculateAtrLast(candles, ATR_PERIOD);
  const avgVolume1m = Number(
    (
      candles
        .slice(-50)
        .reduce((sum, c) => sum + Math.max(0, c.volume), 0) /
      Math.max(1, Math.min(50, candles.length))
    ).toFixed(6),
  );
  const dayLow24h = toNumber(
    ticker?.low,
    candles.slice(-Math.min(1440, candles.length)).reduce(
      (minLow, c) => Math.min(minLow, c.low),
      Number.POSITIVE_INFINITY,
    ),
  );
  const volume24hQuote = toNumber(
    (ticker as { quoteVolume?: unknown })?.quoteVolume,
    NaN,
  );
  const totalBidVolume = (orderBook?.bids ?? [])
    .slice(0, 5)
    .reduce((sum, level) => sum + Math.max(0, toNumber(level?.[1], 0)), 0);
  const totalAskVolume = (orderBook?.asks ?? [])
    .slice(0, 5)
    .reduce((sum, level) => sum + Math.max(0, toNumber(level?.[1], 0)), 0);
  const imbalance_ratio = Number(
    (
      totalBidVolume / Math.max(totalAskVolume, Number.EPSILON)
    ).toFixed(6),
  );

  const burst = computeVolatilityBurstGuard(candles);

  return {
    symbol,
    latestPrice,
    imbalance_ratio,
    candles5,
    candles15,
    candles15m: candles15mTail,
    candles1h: candles1hTail,
    candles4h: candles4hTail,
    trend_htf: {
      trend_1h: trend1h,
      trend_4h: trend4h,
      mtf_aligned,
      trend_15m: trend15m,
      mtf_ltf_aligned,
      mtf_effective_ok,
    },
    marketRegime,
    adx14,
    atr14,
    dayLow24h,
    volume24hQuote: Number.isFinite(volume24hQuote) && volume24hQuote >= 0
      ? volume24hQuote
      : null,
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
    volBurstWidenMult: burst.widenMult,
    volBurstMeta: burst.meta,
  };
  } catch (e) {
    botError("market-data", "fetch_indicator_snapshot_failed", {
      symbol,
      detail: formatUnknownError(e),
    });
    throw e;
  }
}

function trendFromCloses(
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

function normalizeCcxtTimeframe(timeframe: string) {
  if (!timeframe) return "1m";
  return timeframe;
}

async function resolveLatestPrice(params: {
  exchange: ccxt.binance;
  ccxtSymbol: string;
  tickerLast: unknown;
  fallbackClose: number;
}) {
  const { exchange, ccxtSymbol, tickerLast, fallbackClose } = params;
  const fromTicker = toNumber(tickerLast, 0);
  if (fromTicker > 0) return fromTicker;

  const fromRecentClose = toNumber(fallbackClose, 0);
  if (fromRecentClose > 0) return fromRecentClose;

  // Fallback path for rare ticker=0 glitches on fast-moving symbols.
  const lastCandle = await exchange.fetchOHLCV(ccxtSymbol, "1m", undefined, 1);
  const lastClose = toNumber(lastCandle?.[0]?.[4], 0);
  return lastClose > 0 ? lastClose : 0;
}

