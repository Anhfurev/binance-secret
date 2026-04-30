// @ts-nocheck
/**
 * Scorecard weights + MIN weighted gate constant. Live BUY floors are merged with
 * regime-specific `min_ai_confidence_*` in `utils.resolveMinAiConfidenceForRegime`
 * and the War Room orchestrator in `war-room.ts` (news veto, whale +10 floor).
 */
import type { AiAnalysis, MarketRegime } from "./types.ts";

/** Weighted multi-factor model — trend-following (ADX > 25 / non-RANGING). */
export const SCORE_WEIGHTS = {
  trend: 0.4,
  momentum: 0.3,
  volume: 0.2,
  order_book: 0.1,
} as const;

/** RANGING regime: de-emphasize trend (avoid chasing), emphasize momentum (mean reversion). */
export const MR_SCORE_WEIGHTS = {
  trend: 0.15,
  momentum: 0.45,
  volume: 0.25,
  order_book: 0.15,
} as const;

export type ScoreWeightsRecord = {
  trend: number;
  momentum: number;
  volume: number;
  order_book: number;
};

const WEIGHT_KEYS = ["trend", "momentum", "volume", "order_book"] as const;

function isValidScoreWeights(w: ScoreWeightsRecord): boolean {
  const sum = w.trend + w.momentum + w.volume + w.order_book;
  if (!Number.isFinite(sum) || sum < 0.5) return false;
  for (const k of WEIGHT_KEYS) {
    const x = w[k];
    if (!Number.isFinite(x) || x < 0.02 || x > 0.65) return false;
  }
  return true;
}

/** Parse `bot_settings.score_weights_*` JSON; returns normalized weights or null. */
export function parseScoreWeightsJson(v: unknown): ScoreWeightsRecord | null {
  if (v == null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const read = (key: string) => {
    const n = Number(o[key]);
    return Number.isFinite(n) ? n : NaN;
  };
  const w: ScoreWeightsRecord = {
    trend: read("trend"),
    momentum: read("momentum"),
    volume: read("volume"),
    order_book: read("order_book"),
  };
  if (!isValidScoreWeights(w)) return null;
  return waterFillNormalizeWeights(w);
}

/**
 * Clamp each weight to [lo, hi] after (re)normalize and iterate until stable.
 * Single clamp-then-divide can let one channel reach ~85% (3×lo + hi on pre-sum).
 * Must match `lib/score-weight-learning.ts` normalizeWeights semantics.
 */
function waterFillNormalizeWeights(w: ScoreWeightsRecord, lo = 0.03, hi = 0.52): ScoreWeightsRecord {
  let cur: ScoreWeightsRecord = {
    trend: Number.isFinite(w.trend) ? Math.max(0, w.trend) : 0,
    momentum: Number.isFinite(w.momentum) ? Math.max(0, w.momentum) : 0,
    volume: Number.isFinite(w.volume) ? Math.max(0, w.volume) : 0,
    order_book: Number.isFinite(w.order_book) ? Math.max(0, w.order_book) : 0,
  };
  let sum0 = cur.trend + cur.momentum + cur.volume + cur.order_book;
  if (!Number.isFinite(sum0) || sum0 <= 0) return w;
  cur = {
    trend: cur.trend / sum0,
    momentum: cur.momentum / sum0,
    volume: cur.volume / sum0,
    order_book: cur.order_book / sum0,
  };
  for (let iter = 0; iter < 8; iter++) {
    const clamped: ScoreWeightsRecord = {
      trend: Math.min(hi, Math.max(lo, cur.trend)),
      momentum: Math.min(hi, Math.max(lo, cur.momentum)),
      volume: Math.min(hi, Math.max(lo, cur.volume)),
      order_book: Math.min(hi, Math.max(lo, cur.order_book)),
    };
    const s = clamped.trend + clamped.momentum + clamped.volume + clamped.order_book;
    if (!Number.isFinite(s) || s <= 0) return w;
    const next: ScoreWeightsRecord = {
      trend: clamped.trend / s,
      momentum: clamped.momentum / s,
      volume: clamped.volume / s,
      order_book: clamped.order_book / s,
    };
    const stable =
      Math.max(
        Math.abs(next.trend - cur.trend),
        Math.abs(next.momentum - cur.momentum),
        Math.abs(next.volume - cur.volume),
        Math.abs(next.order_book - cur.order_book),
      ) < 1e-6 &&
      next.trend <= hi + 1e-9 &&
      next.momentum <= hi + 1e-9 &&
      next.volume <= hi + 1e-9 &&
      next.order_book <= hi + 1e-9 &&
      next.trend >= lo - 1e-9 &&
      next.momentum >= lo - 1e-9 &&
      next.volume >= lo - 1e-9 &&
      next.order_book >= lo - 1e-9;
    cur = next;
    if (stable) break;
  }
  return cur;
}

function mergeDefaultsWithJson(
  defaults: typeof SCORE_WEIGHTS,
  json: unknown,
): ScoreWeightsRecord {
  const parsed = parseScoreWeightsJson(json);
  if (parsed) return parsed;
  return { ...defaults };
}

/**
 * Resolved TF + MR weight packs for the live bot (DB overrides merged with defaults).
 */
export function getResolvedScoreWeightsPack(
  row: Record<string, unknown> | null | undefined,
): { tf: ScoreWeightsRecord; mr: ScoreWeightsRecord } {
  return {
    tf: mergeDefaultsWithJson(SCORE_WEIGHTS, row?.score_weights_tf),
    mr: mergeDefaultsWithJson(MR_SCORE_WEIGHTS, row?.score_weights_mr),
  };
}

/** Hard gate before placing a BUY (sideways / low-conviction bleed filter). */
export const MIN_WEIGHTED_CONFIDENCE_TO_EXECUTE_BUY = 78;

function clamp0100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function clampSubScore(value: unknown): number {
  return clamp0100(Number(value));
}

/**
 * Weighted confidence used for hybrid matrix + execution gate.
 * Formula: trend*0.4 + momentum*0.3 + volume*0.2 + order_book*0.1
 */
function computeWeightedWithWeights(
  ai: AiAnalysis,
  w: ScoreWeightsRecord,
): number {
  const t = clamp0100(Number(ai.trend_score ?? 0));
  const m = clamp0100(Number(ai.momentum_score ?? 0));
  const v = clamp0100(Number(ai.volume_score ?? 0));
  const o = clamp0100(Number(ai.order_book_score ?? 0));
  const raw =
    t * w.trend +
    m * w.momentum +
    v * w.volume +
    o * w.order_book;
  if (!Number.isFinite(raw)) return 0;
  return Math.min(100, Math.round(raw * 100) / 100);
}

export function computeWeightedConfidence(ai: AiAnalysis): number {
  return computeWeightedWithWeights(ai, SCORE_WEIGHTS);
}

/**
 * ADX regime from snapshot: RANGING → mean-reversion weights; else trend-following.
 * Pass `resolvedWeights` from `getResolvedScoreWeightsPack(row)` for the active profile.
 */
export function computeWeightedConfidenceForRegime(
  ai: AiAnalysis,
  marketRegime: MarketRegime,
  resolvedWeights?: ScoreWeightsRecord | null,
): number {
  const w =
    resolvedWeights && isValidScoreWeights(resolvedWeights)
      ? resolvedWeights
      : marketRegime === "RANGING"
      ? MR_SCORE_WEIGHTS
      : SCORE_WEIGHTS;
  return computeWeightedWithWeights(ai, w);
}

/**
 * Reconstructs weighted confidence **before** the sentiment scorecard × penalty_factor
 * (e.g. 0.7 = 30% haircut on all four sub-scores). Used for `ai_reasoning` audit vs
 * `raw_weighted_confidence` (computed on post-haircut scores).
 */
export function estimatePreSentimentWeightedForRegime(
  ai: AiAnalysis,
  marketRegime: MarketRegime,
  resolvedWeights?: ScoreWeightsRecord | null,
): number | null {
  const sv = ai.sentiment_vibe;
  if (!sv?.penalty_applied || sv.penalty_factor == null) return null;
  const f = Number(sv.penalty_factor);
  if (!Number.isFinite(f) || f <= 0 || f >= 1) return null;
  const inv: AiAnalysis = {
    ...ai,
    trend_score: clamp0100(Number(ai.trend_score ?? 0) / f),
    momentum_score: clamp0100(Number(ai.momentum_score ?? 0) / f),
    volume_score: clamp0100(Number(ai.volume_score ?? 0) / f),
    order_book_score: clamp0100(Number(ai.order_book_score ?? 0) / f),
  };
  return computeWeightedConfidenceForRegime(inv, marketRegime, resolvedWeights);
}

/** ~15 words max for Telegram / trades JSON. */
export function truncateProTip(text: string, maxWords = 15): string {
  const w = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  return w.slice(0, maxWords).join(" ");
}
