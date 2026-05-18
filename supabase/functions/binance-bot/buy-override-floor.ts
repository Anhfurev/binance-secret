// @ts-nocheck
import type { ConfidencePolicy } from "./confidence-policy.ts";
import type { TradeRegime } from "./regime-scaling.ts";
import { clamp } from "./utils.ts";

/** Volatile-regime floor cap for confirmed force / BTC-overbought overrides. */
export const FORCE_BUY_OVERRIDE_FLOOR_PCT = 55;

const FORCE_BUY_OVERRIDE_STAMPS = [
  "force_buy_override",
  "btc_overbought_strong_buy_override",
] as const;

export function isConfirmedForceBuyOverrideStamp(trace?: string | null): boolean {
  const s = String(trace ?? "");
  if (!s.length) return false;
  return FORCE_BUY_OVERRIDE_STAMPS.some((token) => s.includes(token));
}

export function readTechScoreFromOverrideStamp(trace?: string | null): number | null {
  const m = String(trace ?? "").match(/tech_score=(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Prevent downstream VOLATILE 70% policy from retro-blocking stamped overrides. */
export function relaxConfidencePolicyForForceBuyOverride(
  policy: ConfidencePolicy,
): ConfidencePolicy {
  const cap = FORCE_BUY_OVERRIDE_FLOOR_PCT;
  return {
    ...policy,
    hybrid_min_ai_confidence: Math.min(policy.hybrid_min_ai_confidence, cap),
    grinder_weighted_floor: Math.min(policy.grinder_weighted_floor, cap),
    trade_regime_weighted_floor: Math.min(policy.trade_regime_weighted_floor, cap),
    execution_weighted_floor: Math.min(policy.execution_weighted_floor, cap),
    war_room_base_floor: Math.min(policy.war_room_base_floor, cap),
  };
}

export function resolveForceBuyOverrideMinAiConfidenceBuy(params: {
  executionWeightedFloor: number;
  assetClassMinAi: number;
  effectiveConfidence: number;
  rawAiConfidence: number;
  technicalScore?: number | null;
}): number {
  const cap = FORCE_BUY_OVERRIDE_FLOOR_PCT;
  const tech = Number(params.technicalScore ?? NaN);
  if (Number.isFinite(tech) && tech >= 9) {
    return Math.min(cap, params.effectiveConfidence, params.rawAiConfidence);
  }
  return Math.min(cap, params.executionWeightedFloor, params.assetClassMinAi);
}

export function relaxMinWeightedEntryForForceBuyOverride(params: {
  minWeightedEntry: number;
  rawWeighted: number;
  rawAiConfidence: number;
  technicalScore?: number | null;
}): number {
  const tech = Number(params.technicalScore ?? NaN);
  if (Number.isFinite(tech) && tech >= 9) {
    return clamp(
      Math.min(params.minWeightedEntry, params.rawWeighted, params.rawAiConfidence),
      1,
      100,
    );
  }
  return clamp(Math.min(params.minWeightedEntry, FORCE_BUY_OVERRIDE_FLOOR_PCT), 1, 100);
}
