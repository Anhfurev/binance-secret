// @ts-nocheck
import ccxt from "ccxt";
import { ATR_PERIOD, KLINE_INTERVAL } from "./constants.ts";
import type { IndicatorSnapshot } from "./types.ts";
import { formatUnknownError, toNumber } from "./utils.ts";
import {
  calculateAtrLast,
  calculateBollingerBands,
  calculateEma,
  calculateMacd,
  calculateRsi,
  computeEmaPair,
} from "./indicators.ts";
import { ccxtBinanceOptionsForRestGateway } from "./binance-rest-base.ts";
import { toCcxtSymbol } from "./exchange-client.ts";
import { sanitizeOhlcvCandles } from "./ohlcv-sanitizer.ts";
import { getRegimeDiagnostics } from "./strategy.ts";
import { computeVolatilityBurstGuard } from "./volatility-burst-predictor.ts";
import { botError } from "./bot-debug.ts";
import {
  applyLatestZeroVolumeCarryForward,
  normalizeCcxtTimeframe,
  resolveLatestPrice,
  trendFromCloses,
  validateIndicatorsOrThrow,
} from "./market-data-helpers.ts";
import { withBoundedPublicExchangeTimeout } from "./market-data-timeout.ts";

let sharedPublicBinance: InstanceType<typeof ccxt.binance> | null = null;

/** 1m bars from Binance (EMA200 needs ≥200). Env `MARKET_OHLCV_1M_LIMIT` clamped 200–400; default 200. */
function readOhlcv1mFetchLimit(): number {
  const raw = Number(Deno.env.get("MARKET_OHLCV_1M_LIMIT") ?? "");
  if (!Number.isFinite(raw) || raw < 200) return 200;
  return Math.min(400, Math.floor(raw));
}

function getSharedPublicBinance(): InstanceType<typeof ccxt.binance> {
  if (!sharedPublicBinance) {
    sharedPublicBinance = new ccxt.binance({
      enableRateLimit: true,
      ...ccxtBinanceOptionsForRestGateway(),
    });
  }
  return sharedPublicBinance;
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
  const ccxtSymbol = toCcxtSymbol(symbol);
  const ohlcv1mLimit = readOhlcv1mFetchLimit();
  const ohlcv15mLimit = Math.min(72, Math.max(40, Math.floor(ohlcv1mLimit / 3)));
  const [
    ohlcv1m,
    ohlcv15m,
    ohlcv1h,
    ohlcv4h,
    orderBook,
    ticker,
  ] = await withBoundedPublicExchangeTimeout(exchange, signal, () =>
    Promise.all([
      exchange.fetchOHLCV(
        ccxtSymbol,
        normalizeCcxtTimeframe(KLINE_INTERVAL),
        undefined,
        ohlcv1mLimit,
      ),
      exchange.fetchOHLCV(
        ccxtSymbol,
        "15m",
        undefined,
        ohlcv15mLimit,
      ),
      exchange.fetchOHLCV(
        ccxtSymbol,
        "1h",
        undefined,
        55,
      ),
      exchange.fetchOHLCV(
        ccxtSymbol,
        "4h",
        undefined,
        32,
      ),
      exchange.fetchOrderBook(ccxtSymbol, 5),
      exchange.fetchTicker(ccxtSymbol),
    ]));
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

  const bestBid = toNumber(orderBook?.bids?.[0]?.[0], 0);
  const bestAsk = toNumber(orderBook?.asks?.[0]?.[0], 0);
  const latestPrice = await withBoundedPublicExchangeTimeout(exchange, signal, () =>
    resolveLatestPrice({
      exchange,
      ccxtSymbol,
      tickerLast: ticker?.last,
      fallbackClose: closes[closes.length - 1] ?? 0,
      streamSymbol: symbol,
      bestBid,
      bestAsk,
      signal,
    }),
  );
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
  const volume24hBase = toNumber(
    (ticker as { baseVolume?: unknown })?.baseVolume ?? (ticker as { volume?: unknown })?.volume,
    NaN,
  );
  const spreadMid = bestBid > 0 && bestAsk > 0
    ? (bestBid + bestAsk) / 2
    : 0;
  const spreadBps = spreadMid > 0 && bestAsk >= bestBid
    ? Number((((bestAsk - bestBid) / spreadMid) * 10_000).toFixed(4))
    : null;
  const totalBidVolume = (orderBook?.bids ?? [])
    .slice(0, 5)
    .reduce((sum, level) => sum + Math.max(0, toNumber(level?.[1], 0)), 0);
  const totalAskVolume = (orderBook?.asks ?? [])
    .slice(0, 5)
    .reduce((sum, level) => sum + Math.max(0, toNumber(level?.[1], 0)), 0);
  const imbalance_ratio = totalAskVolume > 0
    ? Number((totalBidVolume / totalAskVolume).toFixed(6))
    : totalBidVolume > 0
    ? 99
    : 1;

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
    volume24hBase: Number.isFinite(volume24hBase) && volume24hBase >= 0
      ? volume24hBase
      : null,
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
