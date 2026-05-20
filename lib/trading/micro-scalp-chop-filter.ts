import type { ScalpCandle } from "@/lib/trading/paper-scalp-indicators";

function envNum(key: string, fallback: number): number {
  const n = Number(String(process.env[key] ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Sideways chop: tight range + price path efficiency near zero (whipsaw).
 * Blocks late RSI/MA-style entries at micro-pump tops.
 */
export function isMicroSidewaysChop(candles: ScalpCandle[]): boolean {
  const window = candles.slice(-20);
  if (window.length < 12) return false;

  const maxChopRangePct = envNum("MICRO_CHOP_MAX_RANGE_PCT", 0.55);
  const maxEfficiency = envNum("MICRO_CHOP_MAX_EFFICIENCY", 0.22);

  let hi = -Infinity;
  let lo = Infinity;
  let sumAbs = 0;
  let net = 0;

  for (let i = 1; i < window.length; i++) {
    const c = window[i]!;
    const p = window[i - 1]!;
    hi = Math.max(hi, c.high);
    lo = Math.min(lo, c.low);
    const d = c.close - p.close;
    sumAbs += Math.abs(d);
    net += d;
  }

  const mid = (hi + lo) / 2;
  if (mid <= 0 || sumAbs <= 0) return false;

  const rangePct = ((hi - lo) / mid) * 100;
  const efficiency = Math.abs(net) / sumAbs;

  return rangePct <= maxChopRangePct && efficiency <= maxEfficiency;
}
