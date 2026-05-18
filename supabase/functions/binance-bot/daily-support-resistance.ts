// @ts-nocheck
import type { Candle } from "./types.ts";

export type DailySupportResistance = {
  support: number[];
  resistance: number[];
  pivot: number;
  method: "daily_pivot_swings";
};

/** Major S/R from daily chart: classic pivots + 20-day swing high/low. */
export function computeDailySupportResistance(
  dailyCandles: Candle[],
): DailySupportResistance {
  const recent = dailyCandles.slice(-20);
  if (recent.length < 2) {
    return { support: [], resistance: [], pivot: 0, method: "daily_pivot_swings" };
  }
  const last = recent[recent.length - 1]!;
  const pivot = Number(
    ((last.high + last.low + last.close) / 3).toFixed(8),
  );
  const range = last.high - last.low;
  const s1 = Number((2 * pivot - last.high).toFixed(8));
  const r1 = Number((2 * pivot - last.low).toFixed(8));
  const s2 = Number((pivot - range).toFixed(8));
  const r2 = Number((pivot + range).toFixed(8));
  const swingLow = Math.min(...recent.map((c) => c.low));
  const swingHigh = Math.max(...recent.map((c) => c.high));
  const support = uniqSortedAsc([s2, s1, swingLow].filter((n) => n > 0));
  const resistance = uniqSortedAsc([r1, r2, swingHigh].filter((n) => n > 0));
  return { support, resistance, pivot, method: "daily_pivot_swings" };
}

function uniqSortedAsc(values: number[]): number[] {
  return [...new Set(values.map((v) => Number(v.toFixed(8))))].sort((a, b) => a - b);
}
