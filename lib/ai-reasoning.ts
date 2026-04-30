/**
 * Parse `trades.ai_reasoning` JSON from the buy-flow (scorecard, MTF cap, pro_tip).
 */

export type WarRoomAuditPayload = {
  agent_votes?: {
    technician?: number;
    news?: string;
    whale?: string;
  };
  final_governance?: string;
  governance_floor?: number;
  base_floor?: number;
  quorum_passed?: boolean;
};

export type AiReasoningPayload = {
  pro_tip?: string;
  /** Weighted score after sentiment haircut, before 1h bearish cap. */
  raw_weighted_confidence?: number;
  /** Weighted score before sentiment scorecard × penalty (e.g. 0.7). */
  weighted_pre_sentiment_vibe?: number;
  sentiment_penalty_applied?: boolean;
  sentiment_penalty_factor?: number;
  effective_confidence?: number;
  one_h_bearish_cap_applied?: boolean;
  one_h_bearish_cap_max?: number;
  market_regime?: string;
  mtf_context?: Record<string, unknown>;
  war_room?: WarRoomAuditPayload;
};

export type AiReasoningSummary = {
  proTip?: string;
  oneHBearishCapApplied?: boolean;
  rawWeightedConfidence?: number;
  weightedPreSentimentVibe?: number;
  sentimentPenaltyApplied?: boolean;
  sentimentPenaltyFactor?: number;
  effectiveConfidence?: number;
  /** War Room governance (when buy-flow persisted `war_room`). */
  warRoomGovernance?: string;
  warRoomNewsVote?: string;
  warRoomWhaleVote?: string;
  warRoomGovernanceFloor?: number;
  warRoomTechnicianScore?: number;
};

function num(x: unknown): number | undefined {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : undefined;
}

export function parseAiReasoning(raw: unknown): AiReasoningPayload | null {
  if (raw == null || raw === "") return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const wr =
    typeof o.war_room === "object" && o.war_room !== null
      ? (o.war_room as Record<string, unknown>)
      : undefined;
  return {
    pro_tip: typeof o.pro_tip === "string" ? o.pro_tip : undefined,
    raw_weighted_confidence: num(o.raw_weighted_confidence),
    weighted_pre_sentiment_vibe: num(o.weighted_pre_sentiment_vibe),
    sentiment_penalty_applied: Boolean(o.sentiment_penalty_applied),
    sentiment_penalty_factor: num(o.sentiment_penalty_factor),
    effective_confidence: num(o.effective_confidence),
    one_h_bearish_cap_applied: Boolean(o.one_h_bearish_cap_applied),
    one_h_bearish_cap_max: num(o.one_h_bearish_cap_max),
    market_regime:
      typeof o.market_regime === "string" ? o.market_regime : undefined,
    mtf_context:
      typeof o.mtf_context === "object" && o.mtf_context !== null
        ? (o.mtf_context as Record<string, unknown>)
        : undefined,
    war_room: wr
      ? {
          agent_votes:
            typeof wr.agent_votes === "object" && wr.agent_votes !== null
              ? (wr.agent_votes as WarRoomAuditPayload["agent_votes"])
              : undefined,
          final_governance:
            typeof wr.final_governance === "string" ? wr.final_governance : undefined,
          governance_floor: num(wr.governance_floor),
          base_floor: num(wr.base_floor),
          quorum_passed:
            typeof wr.quorum_passed === "boolean" ? wr.quorum_passed : undefined,
        }
      : undefined,
  };
}

export function toAiReasoningSummary(
  raw: unknown,
): AiReasoningSummary | undefined {
  const p = parseAiReasoning(raw);
  if (!p) return undefined;
  const tip = p.pro_tip?.trim();
  const wr = p.war_room;
  const hasWarRoom =
    typeof wr?.final_governance === "string" && wr.final_governance.length > 0;
  const hasSignal =
    Boolean(tip) ||
    p.one_h_bearish_cap_applied === true ||
    p.raw_weighted_confidence != null ||
    p.effective_confidence != null ||
    p.weighted_pre_sentiment_vibe != null ||
    hasWarRoom;
  if (!hasSignal) return undefined;
  const av = wr?.agent_votes;
  return {
    proTip: tip || undefined,
    oneHBearishCapApplied: p.one_h_bearish_cap_applied === true,
    rawWeightedConfidence: p.raw_weighted_confidence,
    weightedPreSentimentVibe: p.weighted_pre_sentiment_vibe,
    sentimentPenaltyApplied: p.sentiment_penalty_applied === true,
    sentimentPenaltyFactor: p.sentiment_penalty_factor,
    effectiveConfidence: p.effective_confidence,
    warRoomGovernance: wr?.final_governance,
    warRoomNewsVote:
      typeof av?.news === "string" ? av.news : undefined,
    warRoomWhaleVote:
      typeof av?.whale === "string" ? av.whale : undefined,
    warRoomGovernanceFloor: wr?.governance_floor,
    warRoomTechnicianScore:
      typeof av?.technician === "number" ? av.technician : num(av?.technician as unknown),
  };
}

/**
 * “Bounce watch” / deep-red pulse: 1h bearish cap active and model conviction was
 * very high — use **pre-sentiment** weighted score when present (post-haircut
 * `raw` can be below 85 even when the model was 90+ before the 30% haircut).
 */
export function isHighRawBearishCap(summary: AiReasoningSummary | null | undefined): boolean {
  if (!summary?.oneHBearishCapApplied) return false;
  const raw = summary.rawWeightedConfidence;
  const pre = summary.weightedPreSentimentVibe;
  const hiRaw = typeof raw === "number" && raw >= 85;
  const hiPre = typeof pre === "number" && pre >= 85;
  return hiRaw || hiPre;
}
