// @ts-nocheck

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function seniorTraderActivityEnabled(
  row: { is_aggressive_mode?: boolean },
  paperOnly: boolean,
): boolean {
  if (Boolean(row?.is_aggressive_mode)) return true;
  if (!paperOnly) return false;
  const raw = String(Deno.env.get("SENIOR_ACTIVITY_MODE") ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

export function applySeniorTraderActivityFloors(params: {
  minAiConfidence: number;
  minTechScore: number;
  enabled: boolean;
}): { minAiConfidence: number; minTechScore: number } {
  if (!params.enabled) {
    return {
      minAiConfidence: params.minAiConfidence,
      minTechScore: params.minTechScore,
    };
  }
  return {
    minAiConfidence: clamp(params.minAiConfidence - 4, 48, 95),
    minTechScore: clamp(params.minTechScore - 1, 4, 10),
  };
}

export function resolveSeniorForceBuyFloors(params: {
  minAiConfidence: number;
  minTechScore: number;
  enabled: boolean;
  forceBuyConfidenceDelta: number;
}): { techFloor: number; confidenceFloor: number } {
  if (!params.enabled) {
    return {
      techFloor: Math.max(7, params.minTechScore + 2),
      confidenceFloor:
        params.minAiConfidence + params.forceBuyConfidenceDelta + 5,
    };
  }
  return {
    techFloor: Math.max(params.minTechScore, 5),
    confidenceFloor: params.minAiConfidence + 2,
  };
}
