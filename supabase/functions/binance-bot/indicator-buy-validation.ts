// @ts-nocheck
import type { IndicatorSnapshot } from "./types.ts";
import { resolveMacdHistogram } from "./dynamic-regime-switcher.ts";
import { minPositiveIndicatorMagnitude } from "./indicator-precision.ts";
import { toNumber } from "./utils.ts";

export const INVALID_ZERO_FOOTPRINT_DETAIL =
  "Execution blocked: Invalid zero-value data footprint detected.";

export type BuyIndicatorValidation =
  | { ok: true }
  | { ok: false; detail: string; codes: string[] };

function isBadCore(value: unknown, minPositive: number): boolean {
  const n = Number(value);
  return !Number.isFinite(n) || n < minPositive;
}

/** Strict pre-buy tape validation (RSI, MACD, EMAs, ATR, price). */
export function validateBuyIndicatorFootprint(
  snapshot: IndicatorSnapshot | null | undefined,
): BuyIndicatorValidation {
  if (!snapshot || typeof snapshot !== "object") {
    return {
      ok: false,
      detail: INVALID_ZERO_FOOTPRINT_DETAIL,
      codes: ["SNAPSHOT_MISSING"],
    };
  }
  const symbol = String(snapshot.symbol ?? "UNKNOWN");
  const px = toNumber(snapshot.latestPrice, 0);
  const minPos = minPositiveIndicatorMagnitude(px);
  const codes: string[] = [];

  if (isBadCore(px, minPos)) codes.push("PRICE_INVALID");
  if (isBadCore(snapshot.rsi, 0)) codes.push("RSI_INVALID");
  if (isBadCore(snapshot.emaFast, minPos)) codes.push("EMA_FAST_INVALID");
  if (isBadCore(snapshot.emaSlow, minPos)) codes.push("EMA_SLOW_INVALID");
  if (isBadCore(snapshot.ema200, minPos)) codes.push("EMA200_INVALID");
  const atr = toNumber(snapshot.atr14, 0);
  if (!Number.isFinite(atr) || atr <= 0) codes.push("ATR_INVALID");

  const hist = resolveMacdHistogram(snapshot);
  if (!Number.isFinite(hist)) codes.push("MACD_HIST_INVALID");

  const adx = toNumber(snapshot.adx14, NaN);
  if (adx === 0 || (Number.isFinite(adx) && adx < 0)) codes.push("ADX_INVALID");

  if (codes.length) {
    return {
      ok: false,
      detail: `${INVALID_ZERO_FOOTPRINT_DETAIL} (${symbol}: ${codes.join(",")})`,
      codes,
    };
  }
  return { ok: true };
}
