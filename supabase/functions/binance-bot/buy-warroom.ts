// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { AiAnalysis, BotSettingsRow, MarketRegime } from "./types.ts";
import { resolveMinAiConfidenceForRegime } from "./utils.ts";
import { evaluateWarRoomConsensus } from "./war-room.ts";
import { sentryWarRoomVetoBreadcrumb, botDebug } from "./bot-debug.ts";
import { logWarRoomGhostSnapshot, safeInsertLog } from "./buy-logging.ts";

export async function resolveWarRoomOutcome(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  userId: string;
  symbol: string;
  ai: AiAnalysis;
  regime: MarketRegime;
  rawWeighted: number;
  effectiveConfidence: number;
  mtf: Record<string, unknown>;
  bearish1hCap: boolean;
  ghostMode: boolean;
  demoProbePaper: boolean;
  snapshotImbalanceRatio?: number;
  snapshotVolume24hQuote?: number | null;
}) {
  const {
    supabase, row, userId, symbol, ai, regime, rawWeighted, effectiveConfidence,
    mtf, bearish1hCap, ghostMode, demoProbePaper, snapshotImbalanceRatio, snapshotVolume24hQuote,
  } = params;

  const imb = Number(snapshotImbalanceRatio);
  const warRoomMarket = {
    imbalance_ratio: Number.isFinite(imb) ? imb : 1,
    volume_24h_quote:
      snapshotVolume24hQuote === null || snapshotVolume24hQuote === undefined
        ? null
        : Number(snapshotVolume24hQuote),
  };
  const baseRegimeFloor = resolveMinAiConfidenceForRegime(
    row as Record<string, unknown>,
    String(regime),
  );
  const warRoom = evaluateWarRoomConsensus({
    rawWeightedConfidence: rawWeighted,
    effectiveChartConfidence: effectiveConfidence,
    ai,
    marketContext: warRoomMarket,
    baseRegimeFloor,
    bearish1hCap,
  });

  if (warRoom.news_veto && !demoProbePaper) {
    sentryWarRoomVetoBreadcrumb({
      final_governance: warRoom.final_governance,
      news_vibe: ai.sentiment_vibe,
      technician_score: warRoom.technician_score,
      userId,
      symbol,
    });
    if (ghostMode) {
      await logWarRoomGhostSnapshot({
        supabase,
        userId,
        symbol,
        warRoom,
        rawWeighted,
        effectiveChart: effectiveConfidence,
        regime,
        detail: "news_veto",
      });
    } else {
      await safeInsertLog(
        supabase,
        {
          user_id: userId,
          symbol,
          level: "info",
          source: "war-room",
          message: "war_room_news_veto",
          meta: {
            event: "war_room_news_veto",
            agent_votes: warRoom.agent_votes,
            raw_weighted: rawWeighted,
            effective_chart: effectiveConfidence,
          },
          created_at: new Date().toISOString(),
        },
        "war_room_news_veto",
      );
    }
    return {
      skipDetail:
        `BUY blocked: War Room news veto (sentiment fear/hack with penalty — chart raw ${rawWeighted.toFixed(2)}%, effective chart ${effectiveConfidence.toFixed(2)}%).`,
      warRoom,
    };
  }

  if (!warRoom.quorum_passed && !demoProbePaper) {
    const goldenRatioBounceCandidate =
      bearish1hCap &&
      rawWeighted >= warRoom.governance_floor;
    if (ghostMode) {
      await logWarRoomGhostSnapshot({
        supabase,
        userId,
        symbol,
        warRoom,
        rawWeighted,
        effectiveChart: effectiveConfidence,
        regime,
        detail: warRoom.final_governance,
      });
    } else {
      await safeInsertLog(
        supabase,
        {
          user_id: userId,
          symbol,
          level: "info",
          source: "war-room",
          message: "war_room_quorum_gate",
          meta: {
            event: "war_room_quorum_blocked",
            agent_votes: warRoom.agent_votes,
            final_governance: warRoom.final_governance,
            raw_weighted: rawWeighted,
            effective_chart: effectiveConfidence,
            governance_floor: warRoom.governance_floor,
            base_floor: warRoom.base_floor,
            bearish_1h_cap: bearish1hCap,
            golden_ratio_bounce_candidate: goldenRatioBounceCandidate,
            market_regime: regime,
          },
          created_at: new Date().toISOString(),
        },
        "war_room_quorum_live",
      );
    }
    return {
      skipDetail:
        `BUY blocked: War Room quorum — technician raw ${rawWeighted.toFixed(2)}% and chart ${effectiveConfidence.toFixed(2)}% must meet or exceed governance floor ${warRoom.governance_floor}% (${warRoom.final_governance}; whale=${warRoom.agent_votes.whale})${bearish1hCap ? "; 1h bearish cap on chart score" : ""}.`,
      warRoom,
    };
  }

  let executionConfidence = warRoom.effective_confidence_after_governance;
  if (demoProbePaper) {
    executionConfidence = Math.max(
      Number(executionConfidence) || 0,
      rawWeighted,
      effectiveConfidence,
      55,
    );
  }
  if (!Number.isFinite(executionConfidence) || executionConfidence <= 0) {
    if (demoProbePaper) {
      executionConfidence = Math.max(55, rawWeighted, effectiveConfidence, 1);
    } else {
      return {
        skipDetail:
          "BUY blocked: post–War Room guard — effective_confidence_after_governance is not finite/positive (would not call exchange).",
        warRoom,
      };
    }
  }
  botDebug("buyFlow", "war_room_gate_passed", {
    userId,
    symbol,
    executionConfidence,
    final_governance: warRoom.final_governance,
    news_veto: warRoom.news_veto,
    quorum_passed: warRoom.quorum_passed,
    governance_floor: warRoom.governance_floor,
    technician_score: warRoom.technician_score,
    effective_chart_confidence: warRoom.effective_chart_confidence,
  });

  return { warRoom, executionConfidence };
}
