// @ts-nocheck
/** Shared BTC regime anchor — compute once per cron preflight, pass down. */
import type { IndicatorSnapshot } from "./types.ts";
import { hasValidNonZeroEma } from "./cycle-indicator-helpers.ts";

export function resolveBtcOverboughtFromMarketCache(
  cache: Map<string, IndicatorSnapshot>,
): boolean {
  const btcSnapshot = cache.get("BTCUSDT");
  if (!btcSnapshot) return false;
  const btcRsi = Number(btcSnapshot.rsi ?? NaN);
  return Number.isFinite(btcRsi) && btcRsi > 70 && hasValidNonZeroEma({
    emaFast: Number(btcSnapshot.emaFast ?? 0),
    emaSlow: Number(btcSnapshot.emaSlow ?? 0),
    ema200: Number(btcSnapshot.ema200 ?? 0),
  });
}
