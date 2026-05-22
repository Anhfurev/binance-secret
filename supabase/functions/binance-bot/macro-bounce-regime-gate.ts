// @ts-nocheck
/**
 * Macro gate for `strategy_oversold_bounce_entry` — stay in USDT until BTC uptrend is confirmed.
 * Mirrors paper Alpha Shield `ACTIVE_SHORT` (risk-off / short-hunt) + explicit 4h EMA21 filter.
 */

import { calculateEma } from "./indicators.ts";
import type { IndicatorSnapshot } from "./types.ts";
import { toNumber } from "./utils.ts";

export const MACRO_REGIME_ACTIVE_SHORT = "ACTIVE_SHORT";

export type BtcMacroBounceGate = {
  blocked: boolean;
  reason: string | null;
  activeShort: boolean;
  btcBelow4hEma21: boolean;
  regimeLabel: string;
  btcEma21_4h: number;
};

export function resolveBtc4hEma21(btc: IndicatorSnapshot | undefined): number {
  if (!btc) return 0;
  const closes = (btc.candles4h ?? []).map((c) => toNumber(c.close, 0)).filter((p) => p > 0);
  if (!closes.length) return 0;
  return calculateEma(closes, 21);
}

export function resolveBtcBelow4hEma21(btc: IndicatorSnapshot | undefined): boolean {
  if (!btc) return true;
  const ema21 = resolveBtc4hEma21(btc);
  const px = toNumber(btc.latestPrice, 0);
  if (ema21 <= 0 || px <= 0) return true;
  return px < ema21;
}

/** 1h EMA9/21 proxy for paper `btcAboveEma21` (edge bot uses 1h bars, not 1m scalp tape). */
export function resolveBtcAbove1hEma21(btc: IndicatorSnapshot | undefined): boolean {
  if (!btc) return false;
  const closes = (btc.candles1h ?? []).map((c) => toNumber(c.close, 0)).filter((p) => p > 0);
  if (closes.length < 12) return false;
  const ema9 = calculateEma(closes, 9);
  const ema21 = calculateEma(closes, 21);
  const px = toNumber(btc.latestPrice, 0);
  return ema9 > ema21 && px > ema21;
}

/** Paper `entryMode === "short"` — risk-off short hunt; no altcoin bounce entries. */
export function resolveActiveShortMacroRegime(btc: IndicatorSnapshot | undefined): boolean {
  if (!btc) return true;
  if (resolveBtcBelow4hEma21(btc)) return true;
  return !resolveBtcAbove1hEma21(btc);
}

export function resolveMacroEntryRegimeLabel(btc: IndicatorSnapshot | undefined): string {
  if (resolveActiveShortMacroRegime(btc)) return MACRO_REGIME_ACTIVE_SHORT;
  if (resolveBtcBelow4hEma21(btc)) return MACRO_REGIME_ACTIVE_SHORT;
  return "RISK_ON_LONG";
}

export function resolveBtcMacroBounceGateFromMarketCache(
  cache: Map<string, IndicatorSnapshot>,
): BtcMacroBounceGate {
  const btc = cache.get("BTCUSDT");
  const btcBelow4hEma21 = resolveBtcBelow4hEma21(btc);
  const activeShort = resolveActiveShortMacroRegime(btc);
  const blocked = activeShort || btcBelow4hEma21;
  let reason: string | null = null;
  if (blocked) {
    if (btcBelow4hEma21 && activeShort) {
      reason = "FAIL_MACRO_ACTIVE_SHORT_AND_BTC_BELOW_4H_EMA21";
    } else if (btcBelow4hEma21) {
      reason = "FAIL_MACRO_BTC_BELOW_4H_EMA21";
    } else {
      reason = "FAIL_MACRO_ACTIVE_SHORT";
    }
  }
  return {
    blocked,
    reason,
    activeShort,
    btcBelow4hEma21,
    regimeLabel: resolveMacroEntryRegimeLabel(btc),
    btcEma21_4h: resolveBtc4hEma21(btc),
  };
}
