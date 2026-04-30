// @ts-nocheck
/**
 * Pre-AI technical gate transparency: scorecard, FAIL_* codes, war_room_audits payload.
 */
import type { createClient } from "npm:@supabase/supabase-js@2";
import { decideHybridMatrix } from "./index-decision.ts";
import type { AiAnalysis, IndicatorSnapshot, SignalDecision } from "./types.ts";

export type HybridMatrixParams = Parameters<typeof decideHybridMatrix>[0];

export type PreflightGateInput = {
  snapshot: IndicatorSnapshot;
  technicalScore: number;
  aggressiveModeEnabled: boolean;
  strategySignal: SignalDecision;
  /** Inclusive minimum technical score (from `bot_settings.min_tech_score`). */
  minTechnicalScore: number;
  /** Optional 24h quote volume floor from DB; <=0 disables volume gate. */
  minVolume24hQuote?: number;
  /** Sandbox environments can bypass strict volume gate. */
  isSandboxMode?: boolean;
  /** Hard override: ghost execution must never FAIL_VOLUME. */
  isGhostExecution?: boolean;
};

/** Build scorecard + veto_reasons from snapshot-only checks (before LLM). */
export function collectPreflightVetoChecks(input: PreflightGateInput): {
  scorecard: Record<string, boolean>;
  veto_reasons: string[];
  passedCount: number;
  totalGates: number;
  ema200RecoveryOk: boolean;
  rsiClimbing: boolean;
} {
  const {
    snapshot,
    technicalScore,
    aggressiveModeEnabled,
    strategySignal,
    minTechnicalScore,
    minVolume24hQuote = 0,
    isSandboxMode = false,
    isGhostExecution = false,
  } = input;
  const price = snapshot.latestPrice;
  const ema200 = snapshot.ema200;
  const ema50 = Number.isFinite(snapshot.ema50) && snapshot.ema50 > 0
    ? snapshot.ema50
    : snapshot.emaSlow;
  const rsi = snapshot.rsi;
  const c5 = snapshot.candles5 ?? [];
  const last = c5.at(-1);
  const prev = c5.at(-2);
  const prev2 = c5.at(-3);
  const shortTapeBullish = Boolean(
    last && prev && prev2 &&
    last.close > prev.close &&
    prev.close > prev2.close
  );
  const rsiClimbing = Boolean(
    last && prev && prev2 &&
      rsi > 38 &&
      (last.close > prev.close || prev.close > prev2.close),
  );
  const ema200RecoveryOk =
    price >= ema200 ||
    (price < ema200 && price > ema50 && rsiClimbing);
  const ema200_ok = ema200RecoveryOk;
  const highConvictionRsiBuffer = technicalScore >= 8 && strategySignal === "BUY";
  const rsiUpperBound = highConvictionRsiBuffer ? 75 : 70;
  let rsi_ok = rsi < rsiUpperBound && rsi > 30;
  let rsiFailCode = "FAIL_RSI_BAND";
  if (rsi >= rsiUpperBound) rsiFailCode = "FAIL_RSI_OVERBOUGHT";
  else if (rsi <= 30) rsiFailCode = "FAIL_RSI_OVERSOLD";
  const th = snapshot.trend_htf;
  const mtfShortBullishOverride = Boolean(
    th?.trend_15m === "flat" && shortTapeBullish
  );
  const mtf_ok = Boolean(th?.mtf_effective_ok) || mtfShortBullishOverride;
  const lastVol = Number(last?.volume ?? 0);
  const vol_ok = isSandboxMode || minVolume24hQuote <= 0
    ? true
    : Number(snapshot.volume24hQuote ?? 0) >= minVolume24hQuote ||
      (snapshot.avgVolume1m > 0 ? lastVol >= snapshot.avgVolume1m * 0.85 : true);
  const techScore_ok =
    aggressiveModeEnabled || technicalScore >= minTechnicalScore;
  const strategySignalNormalized = strategySignal === "BUY" || strategySignal === "SELL" || strategySignal === "HOLD"
    ? strategySignal
    : "HOLD";
  const strategy_buy_ok = strategySignalNormalized === "BUY";

  const scorecard: Record<string, boolean> = {
    ema200: ema200_ok,
    rsi_ok,
    mtf_ok,
    vol_ok,
    tech_score_ok: techScore_ok,
    strategy_buy_ok,
  };

  const veto_reasons: string[] = [];
  if (!ema200_ok) veto_reasons.push("FAIL_EMA200");
  if (!rsi_ok) veto_reasons.push(rsiFailCode);
  if (!mtf_ok) veto_reasons.push("FAIL_MTF_ALIGNMENT");
  if (!vol_ok) veto_reasons.push("FAIL_VOLUME");
  if (!techScore_ok) veto_reasons.push("FAIL_TECH_SCORE");
  if (strategySignalNormalized !== strategySignal) {
    veto_reasons.push("FAIL_STRATEGY_SIGNAL_INVALID");
  }
  if (!strategy_buy_ok) veto_reasons.push("FAIL_STRATEGY_NO_BUY");

  const vals = Object.values(scorecard);
  const passedCount = vals.filter(Boolean).length;
  const totalGates = vals.length;

  return {
    scorecard,
    veto_reasons,
    passedCount,
    totalGates,
    ema200RecoveryOk,
    rsiClimbing,
  };
}

export function formatVetoDetailsPayload(parts: {
  veto_reasons: string[];
  scorecard: Record<string, boolean>;
  passedCount: number;
  totalGates: number;
  reason?: string;
  decision?: string;
  sentiment_fear_greed?: number | null;
  mtf_half_position?: boolean;
  /** Effective inclusive min technical score for this cycle (`bot_settings.min_tech_score`). */
  min_tech_score?: number;
  /** Effective 24h quote-volume floor for this cycle (`bot_settings.min_volume_24h_quote`). */
  min_volume_24h_quote?: number;
}): Record<string, unknown> {
  return {
    ...parts,
    ts: new Date().toISOString(),
  };
}

/**
 * If strict 1h/4h is misaligned but everything else passes with a fake AI=BUY,
 * allow half-size when live model stayed HOLD with very high confidence (>90).
 */
export function tryMtfOnlyHighConfidenceHalfBuy(params: {
  matrix: HybridMatrixParams;
  snapshot: IndicatorSnapshot;
  decision: SignalDecision;
  reason: string;
  ai: AiAnalysis;
}): { apply: boolean; executionUsdScale?: number } {
  const { matrix, snapshot, decision, reason, ai } = params;
  if (decision !== "HOLD" || reason !== "hold_ai_action_not_buy") {
    return { apply: false };
  }
  if (matrix.strategySignal !== "BUY" || matrix.hasOpenTrade) return { apply: false };
  const conf = Number(ai.ai_confidence);
  if (!Number.isFinite(conf) || conf <= 90) return { apply: false };
  if (snapshot.trend_htf?.mtf_aligned !== false) return { apply: false };
  const fakeAi = { ...ai, action: "BUY" as const };
  const alt = decideHybridMatrix({ ...matrix, ai: fakeAi });
  if (alt.decision !== "BUY") return { apply: false };
  return { apply: true, executionUsdScale: 0.5 };
}

export async function insertWarRoomAudit(params: {
  supabase: ReturnType<typeof createClient>;
  user_id: string | null;
  symbol: string;
  bot_id: string | null;
  cycle_id: string;
  veto_details: Record<string, unknown>;
  final_decision: string;
  technical_score: number;
  ai_confidence: number | null;
}): Promise<void> {
  const { supabase, user_id, symbol, bot_id, cycle_id, veto_details, final_decision, technical_score, ai_confidence } =
    params;
  const { error } = await supabase.from("war_room_audits").insert([
    {
      user_id,
      symbol,
      bot_id,
      cycle_id,
      veto_details,
      final_decision,
      technical_score,
      ai_confidence,
      created_at: new Date().toISOString(),
    },
  ]);
  if (error) {
    console.warn(`[war_room_audits] insert skipped: ${error.message}`);
  }
}
