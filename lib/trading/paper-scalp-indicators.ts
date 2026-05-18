/** 1h OHLCV math — EMA(9/21), RSI(14), ATR(14), crossover detection. */

import {
  priceIndicatorScale,
  scaleOhlc,
} from "@/lib/trading/micro-price";

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
  rsi14: number;
  bullishCross: boolean;
  bearishCross: boolean;
};

export function computeRsiSeries(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return [];

  const out: number[] = new Array(closes.length).fill(50);
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (i < period) continue;

    if (i === period) {
      let sumGain = 0;
      let sumLoss = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const c = closes[j] - closes[j - 1];
        sumGain += c > 0 ? c : 0;
        sumLoss += c < 0 ? -c : 0;
      }
      avgGain = sumGain / period;
      avgLoss = sumLoss / period;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  }

  return out;
}

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
  if (candles.length < 30) return null;

  const closes = candles.map((c) => c.close);
  const refClose = closes[closes.length - 1] ?? closes[0] ?? 0;
  const scale = priceIndicatorScale(refClose);
  const scaledCandles = scaleOhlc(candles, scale);
  const scaledCloses = scaledCandles.map((c) => c.close);

  const ema9 = computeEmaSeries(scaledCloses, 9);
  const ema21 = computeEmaSeries(scaledCloses, 21);
  const atrSeries = computeAtrSeries(scaledCandles, 14);
  const rsiSeries = computeRsiSeries(scaledCloses, 14);
  const i = closes.length - 1;
  const prev = i - 1;
  if (prev < 0) return null;

  const latestEma9 = ema9[i] / scale;
  const latestEma21 = ema21[i] / scale;
  const prevEma9 = ema9[prev] / scale;
  const prevEma21 = ema21[prev] / scale;
  const atr14 = atrSeries[i] / scale;
  const rsi14 = rsiSeries[i] ?? 50;

  return {
    symbol,
    close: closes[i],
    ema9: latestEma9,
    ema21: latestEma21,
    prevEma9,
    prevEma21,
    atr14,
    rsi14,
    bullishCross: prevEma9 <= prevEma21 && latestEma9 > latestEma21,
    bearishCross: prevEma9 >= prevEma21 && latestEma9 < latestEma21,
  };
}

export const ATR_STOP_LOSS_MULT = 1.5;
export const MIN_RISK_REWARD_RATIO = 2.5;

export type AtrStopPlan = {
  stopLoss: number;
  takeProfit: number;
  riskDistance: number;
  rewardDistance: number;
  riskRewardRatio: number;
};

/** SL from ATR volatility; TP enforces min 1:2.5 R:R from entry. */
export function computeAtrStops(
  entryPrice: number,
  atr14: number,
  side: "long",
  stopMult = ATR_STOP_LOSS_MULT,
  rewardMult = MIN_RISK_REWARD_RATIO,
): AtrStopPlan {
  const stopDist = atr14 * stopMult;
  const stopLoss =
    side === "long" ? entryPrice - stopDist : entryPrice + stopDist;
  const riskDistance = Math.abs(entryPrice - stopLoss);
  const rewardDistance = riskDistance * rewardMult;
  const takeProfit =
    side === "long"
      ? entryPrice + rewardDistance
      : entryPrice - rewardDistance;

  return {
    stopLoss: Number(stopLoss.toFixed(8)),
    takeProfit: Number(takeProfit.toFixed(8)),
    riskDistance: Number(riskDistance.toFixed(8)),
    rewardDistance: Number(rewardDistance.toFixed(8)),
    riskRewardRatio: rewardMult,
  };
}

export function formatRiskRewardLogLine(
  plan: AtrStopPlan,
  positionSizeUsdt: number,
  entryPrice: number,
): string {
  const qty = entryPrice > 0 ? positionSizeUsdt / entryPrice : 0;
  const riskDollars = Number((plan.riskDistance * qty).toFixed(4));
  const rewardDollars = Number((plan.rewardDistance * qty).toFixed(4));
  return `1:${plan.riskRewardRatio} (Risking $${riskDollars} to make $${rewardDollars})`;
}
