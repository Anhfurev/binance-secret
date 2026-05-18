// @ts-nocheck
import { DEFAULT_MIN_AI_CONFIDENCE } from "./constants.ts";
import { ONE_H_BEARISH_MAX_CONFIDENCE } from "./buy-helpers.ts";
import { toNumber } from "./utils.ts";
import {
  resolveRegimeScalingFloors,
  type TradeRegime,
} from "./regime-scaling.ts";

export const WAR_ROOM_WHALE_FLOOR_BOOST = 10;
export const NEAR_MISS_BAND_MIN = 65;
export const NEAR_MISS_BAND_MAX = 72;

export type ConfidencePolicy = {
  market_regime: string;
  trade_regime: TradeRegime;
  hybrid_min_ai_confidence: number;
  grinder_weighted_floor: number;
  trade_regime_weighted_floor: number;
  execution_weighted_floor: number;
  war_room_base_floor: number;
  war_room_whale_boost: number;
  bearish_1h_weighted_cap: number;
  near_miss_band: { min: number; max: number };
};

function clampPct(value: number): number {
  return Math.max(1, Math.min(100, value));
}

function readAggressionDelta(): number {
  const raw = String(Deno.env.get("CONFIDENCE_POLICY_AGGRESSION_DELTA") ?? "0").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(20, Math.floor(n));
}

function readProfessionalExpectancyEnabled(): boolean {
  const raw = String(Deno.env.get("PROFESSIONAL_EXPECTANCY_MODE") ?? "1")
    .trim()
    .toLowerCase();
  return raw !== "0" && raw !== "false";
}

function readGrinderEnvFloor(): number {
  const raw = String(Deno.env.get("GRINDER_MIN_WEIGHTED_CONFIDENCE") ?? "").trim();
  const n = raw.length ? Number(raw) : 62;
  if (!Number.isFinite(n)) return 62;
  return clampPct(n);
}

function readTradeRegimeWeightedFloor(tradeRegime: TradeRegime): number {
  const base = resolveRegimeScalingFloors(tradeRegime).minAiConfidence;
  const envKey = `TRADE_REGIME_${tradeRegime}_WEIGHTED_FLOOR`;
  const aliasKey = tradeRegime === "VOLATILE"
    ? "REGIME_VOLATILE_WEIGHTED_FLOOR"
    : tradeRegime === "CHAOS"
      ? "REGIME_CHAOS_WEIGHTED_FLOOR"
      : tradeRegime === "STABLE"
        ? "REGIME_STABLE_WEIGHTED_FLOOR"
        : "";
  const raw = String(Deno.env.get(envKey) ?? "").trim()
    || (aliasKey ? String(Deno.env.get(aliasKey) ?? "").trim() : "");
  const override = raw.length ? Number(raw) : NaN;
  const floor = Number.isFinite(override) ? override : base;
  return clampPct(floor - readAggressionDelta());
}

export function resolveMarketRegimeMinAiConfidence(
  row: Record<string, unknown>,
  marketRegime: string,
): number {
  const base = clampPct(toNumber(row.min_ai_confidence, DEFAULT_MIN_AI_CONFIDENCE));
  if (marketRegime === "TRENDING") {
    const t = row.min_ai_confidence_trending;
    if (t === null || t === undefined) return base;
    return clampPct(toNumber(t, base));
  }
  if (marketRegime === "RANGING") {
    const r = row.min_ai_confidence_ranging;
    if (r === null || r === undefined) return base;
    return clampPct(toNumber(r, base));
  }
  return base;
}

export function resolveGrinderWeightedFloor(marketRegime: string): number {
  let floor = readGrinderEnvFloor();
  if (!readProfessionalExpectancyEnabled()) {
    return clampPct(floor - readAggressionDelta());
  }
  const regime = String(marketRegime ?? "NEUTRAL").toUpperCase();
  if (regime === "RANGING" || regime === "NEUTRAL") {
    floor = Math.min(floor, 68);
  } else if (regime === "TRENDING") {
    floor = Math.min(floor, 64);
  }
  return clampPct(floor - readAggressionDelta());
}

export function resolveConfidencePolicy(
  row: Record<string, unknown>,
  params: { marketRegime: string; tradeRegime: TradeRegime },
): ConfidencePolicy {
  const marketRegime = String(params.marketRegime ?? "NEUTRAL");
  const hybridMin = resolveMarketRegimeMinAiConfidence(row, marketRegime);
  const grinder = resolveGrinderWeightedFloor(marketRegime);
  const tradeRegimeWeighted = readTradeRegimeWeightedFloor(params.tradeRegime);
  const executionWeighted = Math.max(grinder, tradeRegimeWeighted, hybridMin);
  const warRoomBase = executionWeighted;

  return {
    market_regime: marketRegime,
    trade_regime: params.tradeRegime,
    hybrid_min_ai_confidence: hybridMin,
    grinder_weighted_floor: grinder,
    trade_regime_weighted_floor: tradeRegimeWeighted,
    execution_weighted_floor: executionWeighted,
    war_room_base_floor: warRoomBase,
    war_room_whale_boost: WAR_ROOM_WHALE_FLOOR_BOOST,
    bearish_1h_weighted_cap: ONE_H_BEARISH_MAX_CONFIDENCE,
    near_miss_band: { min: NEAR_MISS_BAND_MIN, max: NEAR_MISS_BAND_MAX },
  };
}

export function resolveRegimeMinAiConfidenceFromPolicy(
  row: Record<string, unknown>,
  marketRegime: string,
  tradeRegime: TradeRegime,
): number {
  return resolveConfidencePolicy(row, { marketRegime, tradeRegime }).execution_weighted_floor;
}

export function resolveNearMissTagFromPolicy(params: {
  weightedScore?: number | null;
  aiConfidence?: number | null;
  policy: ConfidencePolicy;
}): string | null {
  const candidates = [params.weightedScore, params.aiConfidence]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!candidates.length) return null;
  const best = Math.max(...candidates);
  const { min, max } = params.policy.near_miss_band;
  if (!Number.isFinite(best) || best < min || best >= max) return null;
  return `near_miss_conviction_${best.toFixed(1)}_below_${params.policy.execution_weighted_floor}`;
}
