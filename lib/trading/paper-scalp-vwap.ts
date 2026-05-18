import type { ScalpCandle } from "@/lib/trading/paper-scalp-indicators";

/** 96 × 15m bars ≈ 24h relative volume baseline. */
export const RVOL_LOOKBACK_BARS = 96;

export function computeSessionVwap(candles: ScalpCandle[]): number | null {
  if (candles.length === 0) return null;

  let pv = 0;
  let volSum = 0;
  for (const c of candles) {
    const vol = c.volume ?? 0;
    if (vol <= 0) continue;
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * vol;
    volSum += vol;
  }

  if (volSum > 0) return pv / volSum;
  return candles[candles.length - 1]?.close ?? null;
}

export function computeRvol24h(candles: ScalpCandle[]): number {
  if (candles.length < 2) return 1;

  const volumes = candles
    .map((c) => c.volume ?? 0)
    .filter((v) => Number.isFinite(v) && v > 0);
  if (volumes.length < 2) return 1;

  const last = volumes[volumes.length - 1] ?? 0;
  const history = volumes.slice(
    Math.max(0, volumes.length - RVOL_LOOKBACK_BARS - 1),
    -1,
  );
  const avg =
    history.length > 0
      ? history.reduce((sum, v) => sum + v, 0) / history.length
      : last;

  if (avg <= 0) return 1;
  return Number((last / avg).toFixed(3));
}
