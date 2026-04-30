// @ts-nocheck
/**
 * Proactive volatility guard (squeeze precursor): not a full GARCH model, but a
 * fast forward-looking heuristic — narrowing Bollinger bandwidth + drying 1m
 * volume often precedes expansion bursts. Used to widen ATR-based stops/trails
 * before realized volatility catches up.
 */
import { VOL_BURST_MAX_ATR_BONUS } from "./constants.ts";
import type { Candle } from "./types.ts";
import { calculateBollingerBands } from "./indicators.ts";

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  const s = xs.reduce((a, b) => a + b, 0);
  return s / xs.length;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export type VolatilityBurstGuard = {
  /** 0 = inactive, 1 = strong squeeze + dry volume. */
  score: number;
  /** Multiplier applied on top of `ATR_STOP_TRAIL_MULTIPLIER` (≥ 1). */
  widenMult: number;
  meta: Record<string, unknown>;
};

const BB_PERIOD = 20;
/** Need enough 1m bars for BB history + volume baselines. */
const MIN_CANDLES = 75;
/** If consecutive 1m `openTime` gaps exceed this, treat stream as dirty (missing bars / clock skew). */
const MAX_BAR_GAP_MS = 3 * 60 * 1000;

/**
 * Rolling BB %bandwidth (vs middle) tightens + recent volume below older baseline
 * → higher score → widen ATR trail/SL preemptively.
 */
export function computeVolatilityBurstGuard(candles: Candle[]): VolatilityBurstGuard {
  if (!Array.isArray(candles) || candles.length < MIN_CANDLES) {
    return {
      score: 0,
      widenMult: 1,
      meta: { reason: "insufficient_candles", n: candles?.length ?? 0 },
    };
  }

  for (let i = 1; i < candles.length; i++) {
    const t0 = Number(candles[i - 1].openTime);
    const t1 = Number(candles[i].openTime);
    const gap = t1 - t0;
    if (!Number.isFinite(gap) || gap <= 0 || gap > MAX_BAR_GAP_MS) {
      return {
        score: 0,
        widenMult: 1,
        meta: {
          reason: "kline_gap_or_nonmonotonic_time",
          i,
          gap_ms: Number.isFinite(gap) ? gap : null,
          max_allowed_ms: MAX_BAR_GAP_MS,
        },
      };
    }
  }

  const closes = candles.map((c) => c.close).filter((x) => Number.isFinite(x) && x > 0);
  if (closes.length !== candles.length) {
    return { score: 0, widenMult: 1, meta: { reason: "invalid_closes" } };
  }
  // Volumes must be sanitized in the SAME shape as candles — `Math.max(0, NaN)`
  // returns NaN, which would silently zero the dry-volume signal downstream.
  // Treat any non-finite/missing volume as a dirty stream and refuse to widen.
  const vols: number[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const raw = (candles[i] as { volume?: unknown }).volume;
    const v = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(v) || v < 0) {
      return {
        score: 0,
        widenMult: 1,
        meta: { reason: "invalid_volume", i, value: raw ?? null },
      };
    }
    vols[i] = v;
  }

  const widths: number[] = [];
  for (let i = BB_PERIOD - 1; i < closes.length; i++) {
    const bb = calculateBollingerBands(closes.slice(0, i + 1), BB_PERIOD, 2);
    const mid = Math.abs(bb.middle) > 1e-12 ? Math.abs(bb.middle) : 1e-12;
    const w = (bb.upper - bb.lower) / mid;
    widths.push(Number.isFinite(w) && w >= 0 ? w : 0);
  }

  if (widths.length < 40) {
    return {
      score: 0,
      widenMult: 1,
      meta: { reason: "insufficient_bb_widths", n: widths.length },
    };
  }

  const shortAvg = mean(widths.slice(-5));
  const longAvg = mean(widths.slice(-38, -13));
  const R = longAvg > 1e-12 ? shortAvg / longAvg : 1;
  const squeeze = R < 1 ? clamp01((1 - R) / 0.22) : 0;

  const volLast10 = mean(vols.slice(-10));
  const volPrev40 = mean(vols.slice(-55, -10));
  const vr = volPrev40 > 1e-9 ? volLast10 / volPrev40 : 1;
  const volDry = vr < 1 ? clamp01((1 - vr) / 0.38) : 0;

  const score = clamp01(0.52 * squeeze + 0.48 * volDry);
  const widenMult = Number((1 + score * VOL_BURST_MAX_ATR_BONUS).toFixed(4));

  return {
    score,
    widenMult,
    meta: {
      model: "bb_squeeze_vol_dry_heuristic",
      bb_width_short_avg: Number(shortAvg.toFixed(6)),
      bb_width_long_avg: Number(longAvg.toFixed(6)),
      bb_width_ratio_short_long: Number(R.toFixed(4)),
      vol_recent_10m_avg: Number(volLast10.toFixed(4)),
      vol_baseline_45m_avg: Number(volPrev40.toFixed(4)),
      vol_ratio_recent_to_baseline: Number(vr.toFixed(4)),
      burst_score: Number(score.toFixed(4)),
      widen_mult: widenMult,
    },
  };
}
