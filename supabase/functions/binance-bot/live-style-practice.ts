// @ts-nocheck
import { TRADING_POLICY } from "./config/trading-policy.ts";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function paperLiveStylePracticeEnabled(isPaperTrading: boolean): boolean {
  if (!isPaperTrading) return false;
  const raw = String(Deno.env.get("PAPER_LIVE_STYLE_PRACTICE") ?? "1")
    .trim()
    .toLowerCase();
  return raw !== "0" && raw !== "false";
}

export function applyLiveStylePracticeFloors(params: {
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
  const p = TRADING_POLICY.paperLiveStylePractice;
  return {
    minAiConfidence: clamp(Math.max(params.minAiConfidence, p.minAiBoostVsIncoming), p.minAiClampLower, p.minAiClampUpper),
    minTechScore: clamp(Math.max(params.minTechScore, p.minTechScoreFloor), p.minTechClampLower, p.minTechClampUpper),
  };
}
