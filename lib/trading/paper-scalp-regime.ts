import type { Scalp1mSnapshot, ScalpCandle } from "@/lib/trading/paper-scalp-indicators";
import { computeSessionVwap } from "@/lib/trading/paper-scalp-vwap";

const BTC_SYMBOL = "BTCUSDT";

export type RegimeEntryMode = "long" | "short" | "none";

export type DynamicTrendScore = {
  score: number;
  emaSpreadPct: number;
  vwapDistancePct: number;
  rsi14: number;
};

export type DynamicMarketRegime = {
  state: "bullish" | "neutral" | "risk_off";
  /** RISK_ON → long entries; RISK_OFF → short hunt (not a hard block). */
  entryMode: RegimeEntryMode;
  trendScore: DynamicTrendScore;
  btcAboveEma21: boolean;
  btcAboveVwap: boolean;
  altSizeMultiplier: number;
  /** True only for API fallback — blocks all new alt entries. */
  blockAltcoinEntries: boolean;
  deployTopN: number;
  fallback: boolean;
};

function computeDynamicTrendScore(
  snap: Scalp1mSnapshot,
  sessionVwap: number | null,
): DynamicTrendScore {
  const close = snap.close;
  const emaSpreadPct =
    snap.ema21 > 0 ? ((snap.ema9 - snap.ema21) / snap.ema21) * 100 : 0;
  const vwapDistancePct =
    sessionVwap && sessionVwap > 0
      ? ((close - sessionVwap) / sessionVwap) * 100
      : 0;

  let score = 0;
  if (snap.ema9 > snap.ema21) score += 35;
  if (close > snap.ema21) score += 20;
  if (sessionVwap && close > sessionVwap) score += 30;
  score += Math.max(-15, Math.min(15, emaSpreadPct * 4));
  score += Math.max(-10, Math.min(10, vwapDistancePct * 2));
  if (snap.rsi14 >= 40 && snap.rsi14 <= 65) score += 10;

  return {
    score: Number(Math.max(-100, Math.min(100, score)).toFixed(2)),
    emaSpreadPct: Number(emaSpreadPct.toFixed(3)),
    vwapDistancePct: Number(vwapDistancePct.toFixed(3)),
    rsi14: Number(snap.rsi14.toFixed(2)),
  };
}

function safeFallbackRegime(reason: string): DynamicMarketRegime {
  console.warn("[alpha-regime] fallback risk-off", { reason });
  return {
    state: "risk_off",
    entryMode: "none",
    trendScore: {
      score: -50,
      emaSpreadPct: 0,
      vwapDistancePct: 0,
      rsi14: 50,
    },
    btcAboveEma21: false,
    btcAboveVwap: false,
    altSizeMultiplier: 0,
    blockAltcoinEntries: true,
    deployTopN: 0,
    fallback: true,
  };
}

/**
 * Institutional regime — BTC EMA21 + session VWAP (Alpha Shield).
 * RISK_OFF activates short-hunt mode instead of blocking all alt entries.
 */
export function calculateDynamicRegime(params: {
  btcSnapshot?: Scalp1mSnapshot;
  btcCandles?: ScalpCandle[];
  apiDegraded?: boolean;
}): DynamicMarketRegime {
  if (params.apiDegraded) {
    return safeFallbackRegime("api_degraded");
  }

  const snap = params.btcSnapshot;
  const candles = params.btcCandles ?? [];
  if (!snap) {
    return safeFallbackRegime("missing_btc_snapshot");
  }

  const sessionVwap = computeSessionVwap(candles);
  const trendScore = computeDynamicTrendScore(snap, sessionVwap);
  const btcAboveEma21 = snap.ema9 > snap.ema21 && snap.close > snap.ema21;
  const btcAboveVwap =
    sessionVwap != null && sessionVwap > 0 && snap.close > sessionVwap;

  if (btcAboveEma21 && btcAboveVwap && trendScore.score >= 45) {
    return {
      state: "bullish",
      entryMode: "long",
      trendScore,
      btcAboveEma21,
      btcAboveVwap,
      altSizeMultiplier: 1,
      blockAltcoinEntries: false,
      deployTopN: 2,
      fallback: false,
    };
  }

  if (btcAboveEma21 && !btcAboveVwap) {
    return {
      state: "neutral",
      entryMode: "long",
      trendScore,
      btcAboveEma21,
      btcAboveVwap: false,
      altSizeMultiplier: 0.5,
      blockAltcoinEntries: false,
      deployTopN: 1,
      fallback: false,
    };
  }

  if (btcAboveEma21 && btcAboveVwap && trendScore.score < 45) {
    return {
      state: "neutral",
      entryMode: "long",
      trendScore,
      btcAboveEma21,
      btcAboveVwap,
      altSizeMultiplier: 0.5,
      blockAltcoinEntries: false,
      deployTopN: 1,
      fallback: false,
    };
  }

  return {
    state: "risk_off",
    entryMode: "short",
    trendScore,
    btcAboveEma21,
    btcAboveVwap,
    altSizeMultiplier: 0.5,
    blockAltcoinEntries: false,
    deployTopN: 1,
    fallback: false,
  };
}

export function resolveBtcSnapshot(
  snapshots: Map<string, Scalp1mSnapshot>,
): Scalp1mSnapshot | undefined {
  return snapshots.get(BTC_SYMBOL);
}

export function resolveBtcCandles(
  candlesBySymbol: Map<string, ScalpCandle[]>,
): ScalpCandle[] {
  return candlesBySymbol.get(BTC_SYMBOL) ?? [];
}
