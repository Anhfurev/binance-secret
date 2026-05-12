// @ts-nocheck
/**
 * Multi-agent "War Room": Technician (chart aggregate), News (veto), Whale (warning + floor lift).
 */
import type { AiAnalysis } from "./types.ts";
import { MIN_WEIGHTED_CONFIDENCE_TO_EXECUTE_BUY } from "./ai-scoring.ts";
import { ONE_H_BEARISH_MAX_CONFIDENCE } from "./buy-helpers.ts";

export type WarRoomMarketContext = {
  imbalance_ratio: number;
  /** 24h quote volume when available (e.g. CCXT ticker); optional second input for Whale agent. */
  volume_24h_quote?: number | null;
};

export type WarRoomAgentVotes = {
  technician: number;
  news: "pass" | "veto";
  whale: "pass" | "warning";
};

export type WarRoomGovernance =
  | "quorum_met"
  | "veto_blocked"
  | "whale_penalty_applied"
  | "quorum_failed";

export type WarRoomConsensus = {
  agent_votes: WarRoomAgentVotes;
  final_governance: WarRoomGovernance;
  base_floor: number;
  governance_floor: number;
  whale_warning: boolean;
  news_veto: boolean;
  /** Chart score used vs floor (raw weighted, pre 1h cap). */
  technician_score: number;
  /** Post 1h-bearish-cap chart score — must also clear floor. */
  effective_chart_confidence: number;
  /** For execution / JSON: 0 on news veto, else effective_chart_confidence. */
  effective_confidence_after_governance: number;
  quorum_passed: boolean;
};

const WHALE_IMBALANCE_WARN_BELOW = 0.4;
const WHALE_FLOOR_BOOST = 10;

function isNegativeFearSentiment(
  sv: NonNullable<AiAnalysis["sentiment_vibe"]> | undefined,
): boolean {
  if (!sv) return false;
  if (Boolean((sv as { hack_major_alert?: boolean }).hack_major_alert)) {
    return true;
  }
  const v = (sv as { fear_greed_value?: number | null }).fear_greed_value;
  /** Extreme fear (<20): contrarian bounce zone — do not news-veto; technician + AI govern. */
  if (typeof v === "number" && Number.isFinite(v) && v < 20) return false;
  if (typeof v === "number" && Number.isFinite(v) && v <= 30) return true;
  const lab = String(
    (sv as { fear_greed_label?: string | null }).fear_greed_label ?? "",
  ).toLowerCase();
  if (
    /extreme\s*fear|extreme\s*fearful|fear|very\s*fearful|anxiet|panic/.test(lab)
  ) {
    return true;
  }
  return false;
}

/**
 * Agent A: `rawWeightedConfidence` (regime-weighted scorecard, post-sentiment haircut).
 * Agent B: VETO if sentiment penalty is on **and** tape reads fear / hack (negative).
 * Agent C: WARNING if order-book bid/ask imbalance shows heavy offer side (`imbalance_ratio` low).
 */
export function evaluateWarRoomConsensus(params: {
  rawWeightedConfidence: number;
  effectiveChartConfidence: number;
  ai: AiAnalysis;
  marketContext: WarRoomMarketContext;
  baseRegimeFloor: number;
  /** When 1h is below EMA200, chart score is capped — align quorum chart leg with that cap. */
  bearish1hCap?: boolean;
}): WarRoomConsensus {
  const {
    rawWeightedConfidence,
    effectiveChartConfidence,
    ai,
    marketContext,
    baseRegimeFloor,
    bearish1hCap = false,
  } = params;

  const sv = ai.sentiment_vibe;
  const penalty = Boolean(
    (sv as { penalty_applied?: boolean } | undefined)?.penalty_applied,
  );
  const newsVeto = penalty && isNegativeFearSentiment(sv);

  const imb = Number(marketContext?.imbalance_ratio);
  const whaleWarning =
    Number.isFinite(imb) && imb < WHALE_IMBALANCE_WARN_BELOW;

  const baseFloor = Math.max(
    1,
    Math.min(
      100,
      Number.isFinite(Number(baseRegimeFloor))
        ? Number(baseRegimeFloor)
        : MIN_WEIGHTED_CONFIDENCE_TO_EXECUTE_BUY,
    ),
  );
  const governanceFloor = Math.min(
    95,
    baseFloor + (whaleWarning ? WHALE_FLOOR_BOOST : 0),
  );

  const technicianScore = Number(rawWeightedConfidence);
  const effChart = Number(effectiveChartConfidence);
  const chartGovernanceFloor = bearish1hCap
    ? Math.min(governanceFloor, ONE_H_BEARISH_MAX_CONFIDENCE)
    : governanceFloor;

  // Use >= so scores exactly on the governance floor still clear quorum,
  // consistent with regime min confidence floors elsewhere.
  const quorumPassed =
    !newsVeto &&
    technicianScore >= governanceFloor &&
    effChart >= chartGovernanceFloor;

  let final_governance: WarRoomGovernance;
  if (newsVeto) {
    final_governance = "veto_blocked";
  } else if (!quorumPassed) {
    final_governance = whaleWarning ? "whale_penalty_applied" : "quorum_failed";
  } else if (whaleWarning) {
    final_governance = "whale_penalty_applied";
  } else {
    final_governance = "quorum_met";
  }

  const effective_confidence_after_governance = newsVeto ? 0 : effChart;

  return {
    agent_votes: {
      technician: Number(technicianScore.toFixed(2)),
      news: newsVeto ? "veto" : "pass",
      whale: whaleWarning ? "warning" : "pass",
    },
    final_governance,
    base_floor: baseFloor,
    governance_floor: governanceFloor,
    whale_warning: whaleWarning,
    news_veto: newsVeto,
    technician_score: technicianScore,
    effective_chart_confidence: effChart,
    effective_confidence_after_governance,
    quorum_passed: quorumPassed,
  };
}
