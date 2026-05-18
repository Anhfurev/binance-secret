/** 1m OHLCV math — EMA(9/21), ATR(14), crossover detection. */

export type ScalpCandle = {
  open: number;
  high: number;
  low: number;
  close: number;
  closeTime: number;
};

export type Scalp1mSnapshot = {
  symbol: string;
  close: number;
  ema9: number;
  ema21: number;
  prevEma9: number;
  prevEma21: number;
  atr14: number;
  bullishCross: boolean;
  bearishCross: boolean;
};

export function computeEmaSeries(closes: number[], period: number): number[] {
  if (closes.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let ema = closes[0];
  for (let i = 0; i < closes.length; i++) {
    ema = i === 0 ? closes[0] : closes[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

export function computeAtrSeries(candles: ScalpCandle[], period: number): number[] {
  if (candles.length === 0) return [];
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      tr.push(candles[i].high - candles[i].low);
      continue;
    }
    const prevClose = candles[i - 1].close;
    tr.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - prevClose),
        Math.abs(candles[i].low - prevClose),
      ),
    );
  }

  const out: number[] = [];
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(period, tr.length));
  for (let i = 0; i < tr.length; i++) {
    if (i < period) {
      const slice = tr.slice(0, i + 1);
      atr = slice.reduce((a, b) => a + b, 0) / slice.length;
    } else {
      atr = (atr * (period - 1) + tr[i]) / period;
    }
    out.push(atr);
  }
  return out;
}

export function buildScalp1mSnapshot(
  symbol: string,
  candles: ScalpCandle[],
): Scalp1mSnapshot | null {
  if (candles.length < 25) return null;

  const closes = candles.map((c) => c.close);
  const ema9 = computeEmaSeries(closes, 9);
  const ema21 = computeEmaSeries(closes, 21);
  const atrSeries = computeAtrSeries(candles, 14);
  const i = closes.length - 1;
  const prev = i - 1;
  if (prev < 0) return null;

  const latestEma9 = ema9[i];
  const latestEma21 = ema21[i];
  const prevEma9 = ema9[prev];
  const prevEma21 = ema21[prev];
  const atr14 = atrSeries[i];

  return {
    symbol,
    close: closes[i],
    ema9: latestEma9,
    ema21: latestEma21,
    prevEma9,
    prevEma21,
    atr14,
    bullishCross: prevEma9 <= prevEma21 && latestEma9 > latestEma21,
    bearishCross: prevEma9 >= prevEma21 && latestEma9 < latestEma21,
  };
}

export function computeAtrStops(
  entryPrice: number,
  atr14: number,
  side: "long",
): { stopLoss: number; takeProfit: number; riskUsd: number; rewardUsd: number } {
  const stopDist = atr14 * 1.5;
  const rewardDist = atr14 * 3;
  const stopLoss = side === "long" ? entryPrice - stopDist : entryPrice + stopDist;
  const takeProfit = side === "long" ? entryPrice + rewardDist : entryPrice - rewardDist;
  return {
    stopLoss: Number(stopLoss.toFixed(8)),
    takeProfit: Number(takeProfit.toFixed(8)),
    riskUsd: Number(stopDist.toFixed(8)),
    rewardUsd: Number(rewardDist.toFixed(8)),
  };
}
