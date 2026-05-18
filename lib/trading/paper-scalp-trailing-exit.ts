import { formatAssetPrice } from "@/lib/trading/paper-scalp-metrics-format";
import type { Scalp1mSnapshot } from "@/lib/trading/paper-scalp-indicators";
import type { DemoTrade } from "@/lib/types";

/** Trailing floor distance: peak − (mult × ATR14). */
export const TRAILING_ATR_MULT = 1.5;

export type TrailingLegUpdate = {
  trade: DemoTrade;
  highestPriceReached: number;
  trailingFloor: number;
  peakUpdated: boolean;
  stopRatcheted: boolean;
};

export function resolveLegAtr14(
  snap: Scalp1mSnapshot | undefined,
  trade: DemoTrade,
): number {
  if (snap?.atr14 && snap.atr14 > 0) return snap.atr14;
  const fallback = Math.abs(trade.entryPrice - trade.stopLoss) / TRAILING_ATR_MULT;
  return fallback > 0 ? fallback : trade.entryPrice * 0.01;
}

export function computeTrailingFloor(
  highestPriceReached: number,
  atr14: number,
  mult = TRAILING_ATR_MULT,
): number {
  return Number((highestPriceReached - atr14 * mult).toFixed(8));
}

/** Soft TP for schema/display only — exits use ATR trail, not this level. */
export function computeOpenEndedTakeProfit(
  entryPrice: number,
  atr14: number,
): number {
  const dist = Math.max(atr14 * 50, entryPrice * 0.05);
  return Number((entryPrice + dist).toFixed(8));
}

/**
 * Peak track + ratchet SL: floor = peak − 1.5×ATR; SL only moves up.
 */
export function applyTrailingProfitState(
  trade: DemoTrade,
  mark: number,
  atr14: number,
): TrailingLegUpdate {
  const priorPeak = trade.highestPriceReached ?? trade.entryPrice;
  const highestPriceReached = Number(Math.max(priorPeak, mark).toFixed(8));
  const peakUpdated = highestPriceReached > priorPeak;

  const trailingFloor = computeTrailingFloor(highestPriceReached, atr14);
  const nextStop = Number(
    Math.max(trade.stopLoss, trailingFloor).toFixed(8),
  );
  const stopRatcheted = nextStop > trade.stopLoss;

  return {
    trade: {
      ...trade,
      highestPriceReached,
      stopLoss: nextStop,
    },
    highestPriceReached,
    trailingFloor,
    peakUpdated,
    stopRatcheted,
  };
}

export function distanceToTrailingFloorPct(
  mark: number,
  stopLoss: number,
): number {
  if (stopLoss <= 0 || mark <= 0) return 0;
  const gap = mark - stopLoss;
  return Number(((gap / mark) * 100).toFixed(2));
}

export function formatTrailingLegManifestLine(
  trade: DemoTrade,
  mark: number,
  atr14: number,
): string {
  const peak = trade.highestPriceReached ?? trade.entryPrice;
  const floor = computeTrailingFloor(peak, atr14);
  const cushionPct = distanceToTrailingFloorPct(mark, trade.stopLoss);
  const peakGainPct =
    trade.entryPrice > 0
      ? Number(
          (((peak - trade.entryPrice) / trade.entryPrice) * 100).toFixed(2),
        )
      : 0;

  return [
    `mark ${formatAssetPrice(mark)}`,
    `peak ${formatAssetPrice(peak)} (+${peakGainPct}%)`,
    `trail SL ${formatAssetPrice(trade.stopLoss)}`,
    `floor ${formatAssetPrice(floor)}`,
    `${cushionPct}% above SL`,
    `ATR×${TRAILING_ATR_MULT}`,
  ].join(" · ");
}
