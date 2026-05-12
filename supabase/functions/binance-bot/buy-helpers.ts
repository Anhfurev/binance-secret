// @ts-nocheck
import { ATR_STOP_TRAIL_MULTIPLIER } from "./constants.ts";
import type { AiAnalysis, MarketRegime } from "./types.ts";
import type { WarRoomConsensus } from "./war-room.ts";
import { clamp } from "./utils.ts";

export const AI_REASONING_JSON_MAX = 50_000;

/** `computeEmaLastFromCloses(closes, 200)` needs `closes.length >= 201`. */
export const MIN_1H_BARS_FOR_LIVE_MTF = 201;
/** When 1h is bearish (close < EMA200 on 1h series), weighted score cannot exceed this before War Room. */
export const ONE_H_BEARISH_MAX_CONFIDENCE = 55;

/** Skip BUY when ADX(14) below this AND regime != TRENDING — chop bleeds via tight SLs. */
export const MIN_ADX_FOR_NON_TRENDING_BUY = 18;
/** TP must be >= this multiple of the stop-loss distance (positive R:R). */
export const MIN_REWARD_RISK_RATIO = 2.0;
/** When ATR is valid, default TP distance = `ATR × this` unless R:R floor lifts it higher. */
export const ATR_TAKE_PROFIT_MULTIPLIER = 2.5;

/**
 * Stop / initial trail distance below entry.
 * When ATR is valid: `max(atrStopMult×ATR, entry×f)` — clamped `pctFallbackFraction` as `f` is a hard
 * minimum; ATR may only widen. When ATR is invalid: `entry×f`.
 */
export function volatilityAdjustedDistanceDown(
  entry: number,
  atr14: number,
  pctFallbackFraction: number,
  /** Effective trail mult (base `ATR_STOP_TRAIL_MULTIPLIER` × vol-burst widen). */
  atrStopMult = ATR_STOP_TRAIL_MULTIPLIER,
): number {
  const f = clamp(pctFallbackFraction, 0.0005, 0.5);
  const m = Number.isFinite(atrStopMult) && atrStopMult > 0 ? atrStopMult : ATR_STOP_TRAIL_MULTIPLIER;
  if (Number.isFinite(atr14) && atr14 > 0 && Number.isFinite(entry) && entry > 0) {
    return Math.max(m * atr14, entry * f);
  }
  return entry * f;
}

/**
 * Compute TP distance above entry with a positive reward:risk floor.
 * Prefers ATR-based distance; falls back to `take_profit_pct`. Always lifted to
 * `MIN_REWARD_RISK_RATIO × slDistance` so winners can pay for losers.
 */
export function takeProfitDistanceUp(
  entry: number,
  atr14: number,
  takeProfitPctFraction: number,
  slDistance: number,
): number {
  const minRel = 0.001;
  const pctFallback = Math.max(
    entry * clamp(takeProfitPctFraction, 0.0005, 1),
    entry * minRel,
  );
  const atrBased =
    Number.isFinite(atr14) && atr14 > 0
      ? ATR_TAKE_PROFIT_MULTIPLIER * atr14
      : 0;
  const rrFloor =
    Number.isFinite(slDistance) && slDistance > 0
      ? slDistance * MIN_REWARD_RISK_RATIO
      : 0;
  const candidate = Math.max(atrBased, pctFallback);
  return Math.max(candidate, rrFloor, entry * minRel);
}

function truncateJsonExcerpt(x: unknown, max: number): string | null {
  if (x == null) return null;
  const s = typeof x === "string" ? x : JSON.stringify(x);
  if (!s) return null;
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** JSON for `trades.ai_reasoning` (frontend + audit): pro_tip, scorecard, effective vs raw weighted, MTF. */
export function buildAiReasoningJson(
  ai: AiAnalysis,
  effectiveConfidence: number,
  audit: {
    raw_weighted: number;
    /** Weighted score before sentiment ×0.7 (30% haircut); null if no penalty. */
    weighted_pre_sentiment_vibe: number | null;
    bearish_1h_cap: boolean;
    mtf: Record<string, unknown>;
    market_regime: MarketRegime;
    adx14: number;
    score_weight_profile: "trend_following" | "mean_reversion";
    /** Weights actually used for `raw_weighted_confidence` (learned + defaults). */
    resolved_weights: Record<string, number>;
    war_room?: WarRoomConsensus;
  },
): string {
  const weightsUsed = { ...audit.resolved_weights };
  const payload: Record<string, unknown> = {
    pro_tip: ai.pro_tip ?? "",
    scorecard: {
      trend_score: ai.trend_score ?? 0,
      momentum_score: ai.momentum_score ?? 0,
      volume_score: ai.volume_score ?? 0,
      order_book_score: ai.order_book_score ?? 0,
    },
    /** Weighted (regime) score after sentiment haircut, before 1h bearish cap. */
    raw_weighted_confidence: audit.raw_weighted,
    /** Weighted score if sentiment had **not** applied scorecard × penalty_factor. */
    weighted_pre_sentiment_vibe: audit.weighted_pre_sentiment_vibe,
    sentiment_penalty_applied: Boolean(ai.sentiment_vibe?.penalty_applied),
    sentiment_penalty_factor: ai.sentiment_vibe?.penalty_factor ?? null,
    effective_confidence: effectiveConfidence,
    one_h_bearish_cap_applied: audit.bearish_1h_cap,
    one_h_bearish_cap_max: ONE_H_BEARISH_MAX_CONFIDENCE,
    mtf_context: audit.mtf,
    market_regime: audit.market_regime,
    adx14: audit.adx14,
    score_weight_profile: audit.score_weight_profile,
    weights: weightsUsed,
    meta: {
      ai_provider: ai.ai_provider ?? null,
      ai_provider_path: ai.ai_provider_path ?? null,
      trend: ai.trend,
      action: ai.action,
      groq_verdict: ai.groq_verdict ?? null,
      sentiment_vibe: ai.sentiment_vibe ?? null,
    },
    groq_reason: ai.groq_reason ?? null,
    raw_model_excerpt: truncateJsonExcerpt(ai.raw_ai_response, 2500),
  };
  if (audit.war_room) {
    const wr = audit.war_room;
    payload.war_room = {
      agent_votes: wr.agent_votes,
      final_governance: wr.final_governance,
      governance_floor: wr.governance_floor,
      base_floor: wr.base_floor,
      quorum_passed: wr.quorum_passed,
      technician_score: wr.technician_score,
      effective_chart_confidence: wr.effective_chart_confidence,
      effective_confidence_after_governance: wr.effective_confidence_after_governance,
    };
  }
  let s = JSON.stringify(payload);
  if (s.length > AI_REASONING_JSON_MAX) {
    payload.raw_model_excerpt = null;
    s = JSON.stringify(payload);
    if (s.length > AI_REASONING_JSON_MAX) {
      s = s.slice(0, AI_REASONING_JSON_MAX);
    }
  }
  return s;
}
