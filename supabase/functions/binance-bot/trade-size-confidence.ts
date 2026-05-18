// @ts-nocheck
import { clamp } from "./utils.ts";

export const DEFAULT_CONFIDENCE_SIZE_MIN_SCALE = 0.75;
export const DEFAULT_CONFIDENCE_SIZE_MAX_SCALE = 1.4;
export const DEFAULT_CONFIDENCE_SIZE_CEILING = 95;

export type ConfidenceTradeSizeScaleResult = {
  scale: number;
  blendedConfidence: number;
  tier: string;
};

export function readConfidenceSizeMinScale(): number {
  const raw = Number(Deno.env.get("CONFIDENCE_SIZE_MIN_SCALE") ?? "");
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CONFIDENCE_SIZE_MIN_SCALE;
  return Math.min(1, Math.max(0.25, raw));
}

export function readConfidenceSizeMaxScale(): number {
  const raw = Number(Deno.env.get("CONFIDENCE_SIZE_MAX_SCALE") ?? "");
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CONFIDENCE_SIZE_MAX_SCALE;
  return Math.min(2.5, Math.max(1, raw));
}

export function resolveConfidenceTradeUsdScale(params: {
  aiConfidence: number;
  weightedConfidence: number;
  minAiConfidence: number;
}): ConfidenceTradeSizeScaleResult {
  const minFloor = Math.max(1, Math.min(99, params.minAiConfidence));
  const ceiling = DEFAULT_CONFIDENCE_SIZE_CEILING;
  const ai = Number.isFinite(params.aiConfidence) ? params.aiConfidence : 0;
  const weighted = Number.isFinite(params.weightedConfidence)
    ? params.weightedConfidence
    : ai;
  const blended = ai * 0.55 + weighted * 0.45;

  const minScale = readConfidenceSizeMinScale();
  const maxScale = readConfidenceSizeMaxScale();
  if (blended <= minFloor) {
    return { scale: minScale, blendedConfidence: blended, tier: "floor" };
  }

  const progress = clamp(
    (blended - minFloor) / Math.max(1, ceiling - minFloor),
    0,
    1,
  );
  const scale = minScale + progress * (maxScale - minScale);

  let tier = "starter";
  if (progress >= 0.85) tier = "exceptional";
  else if (progress >= 0.55) tier = "strong";
  else if (progress >= 0.25) tier = "standard";

  return { scale, blendedConfidence: blended, tier };
}

export function applyConfidenceSizedTradeUsd(params: {
  baseTradeUsd: number;
  currentBalance: number;
  minTradeUsd: number;
  sizing: ConfidenceTradeSizeScaleResult;
  executionUsdScale?: number;
  useConfidenceScale: boolean;
}): number {
  let tradeUsd = params.baseTradeUsd;
  if (params.useConfidenceScale) {
    tradeUsd *= params.sizing.scale;
  }
  const scaleUsd = Number(params.executionUsdScale ?? 1);
  if (Number.isFinite(scaleUsd) && scaleUsd > 0 && scaleUsd < 1) {
    tradeUsd *= scaleUsd;
  }
  return Math.min(
    params.currentBalance,
    Math.max(params.minTradeUsd, tradeUsd),
  );
}

export function scaleTradeUsdByGovernanceConfidence(params: {
  tradeUsd: number;
  executionConfidence: number;
  effectiveConfidence: number;
  minTradeUsd: number;
  currentBalance: number;
  /** Rubber-band bounce: War Room floor already relaxed — do not shrink notional again. */
  preserveNotional?: boolean;
}): number {
  const tradeUsd = Math.max(0, params.tradeUsd);
  if (params.preserveNotional) {
    return Math.min(params.currentBalance, Math.max(params.minTradeUsd, tradeUsd));
  }
  const effective = Math.max(0, params.effectiveConfidence);
  const execution = Math.max(0, params.executionConfidence);
  if (!(effective > 0) || !(execution > 0)) {
    return Math.min(params.currentBalance, Math.max(params.minTradeUsd, tradeUsd));
  }
  const ratio = Math.min(1, execution / effective);
  const scaled = tradeUsd * Math.max(0.25, ratio);
  return Math.min(params.currentBalance, Math.max(params.minTradeUsd, scaled));
}
