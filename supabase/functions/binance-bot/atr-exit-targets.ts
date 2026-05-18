// @ts-nocheck
/** Volatility-scaled stop / take-profit distances at entry (price units). */
import type { IndicatorSnapshot } from "./types.ts";
import type { DynamicTradingRegime } from "./dynamic-regime-switcher.ts";
import { toNumber } from "./utils.ts";

/** Stop loss distance = entry − (slMult × ATR). Default 2×ATR (~1:1.75 R:R with 3.5× TP). */
export const ATR_STOP_LOSS_MULTIPLIER_DEFAULT = 2;
/** Take profit distance = entry + (tpMult × ATR). */
export const ATR_TAKE_PROFIT_MULTIPLIER_DEFAULT = 3.5;

export type AtrExitLevels = {
  entry: number;
  atr14: number;
  atrPct: number | null;
  slAtrMult: number;
  tpAtrMult: number;
  slDistance: number;
  tpDistance: number;
  stopLoss: number;
  takeProfit: number;
  rewardRiskRatio: number;
  basis: "atr_scaled" | "pct_fallback";
};

function readEnvMult(key: string, fallback: number, min: number, max: number): number {
  const n = Number(String(Deno.env.get(key) ?? "").trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function readAtrStopLossMultiplier(_regime?: DynamicTradingRegime): number {
  return readEnvMult(
    "ATR_STOP_LOSS_MULTIPLIER",
    readEnvMult("REGIME_TRENDING_ATR_SL_MULT", ATR_STOP_LOSS_MULTIPLIER_DEFAULT, 1, 4),
    1,
    4,
  );
}

export function readAtrTakeProfitMultiplier(_regime?: DynamicTradingRegime): number {
  return readEnvMult(
    "ATR_TAKE_PROFIT_MULTIPLIER",
    readEnvMult("REGIME_TRENDING_ATR_TP_MULT", ATR_TAKE_PROFIT_MULTIPLIER_DEFAULT, 1.5, 6),
    1.5,
    6,
  );
}

export function resolveSnapshotAtr14(snapshot: Pick<IndicatorSnapshot, "atr14" | "latestPrice">): {
  atr14: number;
  atrPct: number | null;
} {
  const atr14 = toNumber(snapshot.atr14, 0);
  const px = toNumber(snapshot.latestPrice, 0);
  const atrPct = px > 0 && atr14 > 0 ? Number(((atr14 / px) * 100).toFixed(6)) : null;
  return { atr14, atrPct };
}

/** Compute SL/TP prices and distances; prefers live ATR, falls back to % when ATR invalid. */
export function computeAtrExitLevels(
  entry: number,
  atr14: number,
  opts?: {
    regime?: DynamicTradingRegime;
    stopLossPctFraction?: number;
    takeProfitPctFraction?: number;
    slAtrMult?: number;
    tpAtrMult?: number;
  },
): AtrExitLevels {
  const px = toNumber(entry, 0);
  const atr = toNumber(atr14, 0);
  const slMult = opts?.slAtrMult ?? readAtrStopLossMultiplier(opts?.regime);
  const tpMult = opts?.tpAtrMult ?? readAtrTakeProfitMultiplier(opts?.regime);
  const slPctFrac = Math.max(0.0005, toNumber(opts?.stopLossPctFraction, 0.02));
  const tpPctFrac = Math.max(0.0005, toNumber(opts?.takeProfitPctFraction, 0.04));

  let slDistance = px * slPctFrac;
  let tpDistance = px * tpPctFrac;
  let basis: AtrExitLevels["basis"] = "pct_fallback";

  if (px > 0 && atr > 0) {
    slDistance = Math.max(slMult * atr, px * slPctFrac);
    tpDistance = Math.max(tpMult * atr, px * tpPctFrac, slDistance * (tpMult / slMult));
    basis = "atr_scaled";
  }

  const stopLoss = Number(Math.max(px * 1e-8, px - slDistance).toFixed(8));
  const takeProfit = Number((px + tpDistance).toFixed(8));
  const rr = slDistance > 0 ? Number((tpDistance / slDistance).toFixed(4)) : 0;

  return {
    entry: px,
    atr14: atr,
    atrPct: px > 0 && atr > 0 ? Number(((atr / px) * 100).toFixed(6)) : null,
    slAtrMult: slMult,
    tpAtrMult: tpMult,
    slDistance,
    tpDistance,
    stopLoss,
    takeProfit,
    rewardRiskRatio: rr,
    basis,
  };
}
