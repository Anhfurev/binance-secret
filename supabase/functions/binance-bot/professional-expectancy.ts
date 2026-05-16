// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import {
  NEAR_MISS_BAND_MAX,
  NEAR_MISS_BAND_MIN,
  resolveGrinderWeightedFloor,
  resolveNearMissTagFromPolicy,
  type ConfidencePolicy,
} from "./confidence-policy.ts";
export const NEAR_MISS_MIN = NEAR_MISS_BAND_MIN;
export const NEAR_MISS_MAX = NEAR_MISS_BAND_MAX;
export const FRICTION_TAX_WARN_PCT = 30;

export function readProfessionalExpectancyEnabled(): boolean {
  const raw = String(Deno.env.get("PROFESSIONAL_EXPECTANCY_MODE") ?? "1")
    .trim()
    .toLowerCase();
  return raw !== "0" && raw !== "false";
}

export function resolveGrinderMinWeightedEntry(marketRegime?: string): number {
  return resolveGrinderWeightedFloor(String(marketRegime ?? "NEUTRAL"));
}

export function isNearMissConviction(score: number): boolean {
  return Number.isFinite(score) && score >= NEAR_MISS_BAND_MIN && score < NEAR_MISS_BAND_MAX;
}

export function resolveNearMissTag(params: {
  weightedScore?: number | null;
  aiConfidence?: number | null;
  grinderFloor: number;
  policy?: ConfidencePolicy;
}): string | null {
  if (params.policy) {
    return resolveNearMissTagFromPolicy({
      weightedScore: params.weightedScore,
      aiConfidence: params.aiConfidence,
      policy: params.policy,
    });
  }
  const candidates = [params.weightedScore, params.aiConfidence]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!candidates.length) return null;
  const best = Math.max(...candidates);
  if (!isNearMissConviction(best)) return null;
  return `near_miss_conviction_${best.toFixed(1)}_below_${params.grinderFloor}`;
}

export function tradeNetUsdFromRow(row: {
  pnl?: unknown;
  extra?: Record<string, unknown> | null;
}): number {
  const extra = row.extra ?? {};
  const fee =
    Number(extra.fee_usd_buy ?? 0) +
    Number(extra.fee_usd_sell ?? 0) +
    Number(extra.fee_usd ?? 0);
  const pnl = Number(row.pnl ?? 0);
  if (!Number.isFinite(pnl)) return 0;
  return pnl - (Number.isFinite(fee) ? fee : 0);
}

export function spreadBoostFromFrictionTaxPct(pctOfNet: number | null): number {
  if (pctOfNet == null || pctOfNet <= FRICTION_TAX_WARN_PCT) return 0;
  const perTen = Number(Deno.env.get("FRICTION_TAX_SPREAD_BOOST_BPS_PER_10PCT") ?? "2");
  const step = Number.isFinite(perTen) && perTen > 0 ? perTen : 2;
  const boost = Math.ceil((pctOfNet - FRICTION_TAX_WARN_PCT) / 10) * step;
  return Math.min(25, Math.max(0, boost));
}

let activeFrictionSpreadBoostBps = 0;
let activeFrictionSpreadBoostAt = 0;

export function setActiveFrictionSpreadBoost(bps: number): void {
  activeFrictionSpreadBoostBps = Math.max(0, Math.floor(Number(bps) || 0));
  activeFrictionSpreadBoostAt = Date.now();
}

export function readActiveFrictionSpreadBoost(): number {
  const ttlMs = 15 * 60 * 1000;
  if (Date.now() - activeFrictionSpreadBoostAt > ttlMs) return 0;
  return activeFrictionSpreadBoostBps;
}

export async function refreshExecutionFrictionSpreadBoost(
  supabase: ReturnType<typeof createClient>,
): Promise<number> {
  if (!readProfessionalExpectancyEnabled()) {
    setActiveFrictionSpreadBoost(0);
    return 0;
  }
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("trades")
    .select("pnl,extra")
    .in("status", ["closed", "stopped"])
    .gte("closed_at", sinceIso)
    .limit(1500);
  if (error) {
    setActiveFrictionSpreadBoost(0);
    return 0;
  }
  let feesUsd = 0;
  let netPnl = 0;
  for (const row of data ?? []) {
    const extra = (row as { extra?: Record<string, unknown> }).extra ?? {};
    feesUsd +=
      Number(extra.fee_usd_buy ?? 0) +
      Number(extra.fee_usd_sell ?? 0) +
      Number(extra.fee_usd ?? 0);
    netPnl += tradeNetUsdFromRow(row as { pnl?: unknown; extra?: Record<string, unknown> });
  }
  const pctOfNet = Math.abs(netPnl) < 1e-9 ? null : (feesUsd / Math.abs(netPnl)) * 100;
  const boost = spreadBoostFromFrictionTaxPct(pctOfNet);
  setActiveFrictionSpreadBoost(boost);
  return boost;
}
