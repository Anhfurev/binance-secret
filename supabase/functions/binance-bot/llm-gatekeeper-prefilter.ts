// @ts-nocheck
/**
 * Gatekeeper-first LLM pipeline: technical + math conviction before any token spend.
 * Phases 1–2 run in cycle-decider; phase 3 + conviction re-check at getAiAnalysis / cascade.
 */

import type { GeminiKeySlot } from "./ai-keys.ts";
import { GLOBAL_BOT_CONFIG } from "./config.ts";
import type { IndicatorSnapshot, MarketRegime } from "./types.ts";
import { buildTechnicalIndicatorFallback } from "./ai-technical-fallback.ts";
import {
  computeWeightedConfidenceForRegime,
  getResolvedScoreWeightsPack,
} from "./ai-scoring.ts";
import { resolveConfidencePolicy } from "./confidence-policy.ts";
import { evaluateMathGuard, type MathGuardInput } from "./math-guard.ts";
import { geminiPoolKeyId, tryGetCronLlmKeyPool } from "./llm-key-pool.ts";
import { geminiSlotToLlmMeta, shouldSkipLlmDbSlotTripleGuard } from "./llm-key-slot-gate.ts";
import { shouldSkipLlmKeyForRotation } from "./llm-key-rotation-guard.ts";
import { resolveTradeRegime, type TradeRegime } from "./regime-scaling.ts";

export const PRE_FILTER_POLICY_FLOOR_LOG =
  "[PRE-FILTER] Symbol skipped. Baseline math cannot clear the policy floor. Aborting AI call to save tokens.";

export type LlmGatekeeperPrefilterResult = {
  allowLlm: boolean;
  shortCircuit: boolean;
  phase: 1 | 2 | 3 | null;
  log: string | null;
  detail: string;
  /** Tape baseline used in phase 2 (when computed). */
  baselineWeighted?: number;
  convictionCeiling?: number;
  convictionFloor?: number;
};

export function readLlmBaselineMaxAiUpliftPct(): number {
  const n = Number(Deno.env.get("LLM_BASELINE_MAX_AI_UPLIFT_PCT") ?? "12");
  if (!Number.isFinite(n) || n < 0) return 12;
  return Math.min(25, Math.floor(n));
}

/** Hard minimum for LLM dispatch — aligns with buy `policy floor 55%` (override via env). */
export function readLlmDispatchMinConvictionPct(): number {
  const n = Number(Deno.env.get("LLM_DISPATCH_MIN_CONVICTION_PCT") ?? "55");
  if (!Number.isFinite(n) || n < 1) return 55;
  return Math.min(100, Math.floor(n));
}

export type LlmGatekeeperPrefilterInput = Omit<MathGuardInput, "symbol"> & {
  symbol: string;
  tradeRegime?: TradeRegime;
  botSettingsRow?: Record<string, unknown> | null;
  /** Cycle-resolved `minAiConfidence` — must match buy-context unified floor. */
  llmDispatchConvictionFloor?: number;
};

/** Same floor used for BUY execution and pre-LLM conviction ceiling. */
export function resolveLlmDispatchConvictionFloor(params: {
  botSettingsRow?: Record<string, unknown> | null;
  marketRegime: MarketRegime;
  tradeRegime: TradeRegime;
  cycleMinAiConfidence?: number;
}): number {
  const policy = resolveConfidencePolicy(
    (params.botSettingsRow ?? {}) as Record<string, unknown>,
    { marketRegime: params.marketRegime, tradeRegime: params.tradeRegime },
  );
  return Math.max(
    readLlmDispatchMinConvictionPct(),
    policy.execution_weighted_floor,
    Number(params.cycleMinAiConfidence ?? 0),
    GLOBAL_BOT_CONFIG.AI_BUY_CONVICTION_THRESHOLD,
  );
}

/** Phase 2 only — tape baseline + uplift vs execution floor (sync, never a Promise). */
export function evaluateConvictionCeilingBlock(input: {
  symbol: string;
  snapshot: IndicatorSnapshot;
  botSettingsRow?: Record<string, unknown> | null;
  tradeRegime?: TradeRegime;
  cycleMinAiConfidence?: number;
}): LlmGatekeeperPrefilterResult | null {
  const symbol = String(input.symbol ?? "").trim() || "UNKNOWN";
  const regime = String(input.snapshot.marketRegime ?? "NEUTRAL") as MarketRegime;
  const tradeRegime = input.tradeRegime ??
    resolveTradeRegime(
      symbol,
      Number(input.snapshot.latestPrice),
      Number(input.snapshot.atr14),
    );
  const floor = resolveLlmDispatchConvictionFloor({
    botSettingsRow: input.botSettingsRow,
    marketRegime: regime,
    tradeRegime,
    cycleMinAiConfidence: input.cycleMinAiConfidence,
  });
  const pack = getResolvedScoreWeightsPack(input.botSettingsRow ?? null);
  const weights = regime === "RANGING" ? pack.mr : pack.tf;
  const tape = buildTechnicalIndicatorFallback(input.snapshot);
  const baselineWeighted = computeWeightedConfidenceForRegime(tape, regime, weights);
  const uplift = readLlmBaselineMaxAiUpliftPct();
  const ceiling = Math.min(100, baselineWeighted + uplift);

  if (ceiling >= floor) {
    return null;
  }

  return {
    allowLlm: false,
    shortCircuit: true,
    phase: 2,
    log: `${PRE_FILTER_POLICY_FLOOR_LOG} (${symbol} baseline=${baselineWeighted.toFixed(1)}% ceiling=${ceiling.toFixed(1)}% floor=${floor}%)`,
    detail: `conviction_ceiling_${ceiling.toFixed(1)}_below_${floor}`,
    baselineWeighted,
    convictionCeiling: ceiling,
    convictionFloor: floor,
  };
}

/** Phases 1–2: firewall + conviction ceiling (floor synced with buy path). */
export function evaluateLlmGatekeeperPrefilter(
  input: LlmGatekeeperPrefilterInput,
): LlmGatekeeperPrefilterResult {
  const phase1 = evaluateMathGuard(input);
  if (!phase1.allowLlm) {
    return {
      allowLlm: false,
      shortCircuit: true,
      phase: 1,
      log: phase1.skipLog,
      detail: phase1.detail,
    };
  }

  if (input.paperScenarioLiveAi) {
    return {
      allowLlm: true,
      shortCircuit: false,
      phase: null,
      log: phase1.passLog,
      detail: phase1.detail,
    };
  }

  /** Open book: exit math only — never force buy-side LLM when hold has no exit trigger. */
  if (input.openTrade) {
    return {
      allowLlm: phase1.allowLlm,
      shortCircuit: !phase1.allowLlm,
      phase: phase1.allowLlm ? null : 1,
      log: phase1.skipLog ?? phase1.passLog,
      detail: phase1.detail,
    };
  }

  const convictionBlock = evaluateConvictionCeilingBlock({
    symbol: input.symbol,
    snapshot: input.snapshot,
    botSettingsRow: input.botSettingsRow,
    tradeRegime: input.tradeRegime,
    cycleMinAiConfidence: input.llmDispatchConvictionFloor,
  });
  if (convictionBlock) {
    return convictionBlock;
  }

  const regime = String(input.snapshot.marketRegime ?? "NEUTRAL") as MarketRegime;
  const tradeRegime = input.tradeRegime ??
    resolveTradeRegime(
      input.symbol,
      Number(input.snapshot.latestPrice),
      Number(input.snapshot.atr14),
    );
  const floor = resolveLlmDispatchConvictionFloor({
    botSettingsRow: input.botSettingsRow,
    marketRegime: regime,
    tradeRegime,
    cycleMinAiConfidence: input.llmDispatchConvictionFloor,
  });
  const pack = getResolvedScoreWeightsPack(input.botSettingsRow ?? null);
  const weights = regime === "RANGING" ? pack.mr : pack.tf;
  const tape = buildTechnicalIndicatorFallback(input.snapshot);
  const baselineWeighted = computeWeightedConfidenceForRegime(tape, regime, weights);
  const ceiling = Math.min(100, baselineWeighted + readLlmBaselineMaxAiUpliftPct());

  return {
    allowLlm: true,
    shortCircuit: false,
    phase: null,
    log: phase1.passLog,
    detail: `conviction_ok baseline=${baselineWeighted.toFixed(1)} ceiling=${ceiling.toFixed(1)} floor=${floor}`,
    baselineWeighted,
    convictionCeiling: ceiling,
    convictionFloor: floor,
  };
}

/** Phase 3: at least one Gemini slot passes triple-guard + key pool (no HTTP yet). */
export function hasDispatchableGeminiSlot(slots: GeminiKeySlot[]): boolean {
  if (!slots.length) return false;
  const pool = tryGetCronLlmKeyPool();
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i]!;
    const meta = geminiSlotToLlmMeta(slot);
    if (shouldSkipLlmDbSlotTripleGuard(meta)) continue;
    const keyId = geminiPoolKeyId(i);
    if (
      !shouldSkipLlmKeyForRotation({
        preferredKeyId: keyId,
        dbRowId: slot.llmDbKeyId,
        slotMeta: meta,
        providerLabel: `Gemini pre-dispatch slot ${i + 1}`,
      }) && (!pool || pool.isKeyEligible(keyId))
    ) {
      return true;
    }
  }
  return false;
}

export function evaluatePhase3SlotPrefilter(
  symbol: string,
  geminiSlots: GeminiKeySlot[],
): LlmGatekeeperPrefilterResult {
  if (hasDispatchableGeminiSlot(geminiSlots)) {
    return {
      allowLlm: true,
      shortCircuit: false,
      phase: null,
      log: null,
      detail: "phase3_slot_available",
    };
  }
  return {
    allowLlm: false,
    shortCircuit: true,
    phase: 3,
    log: `[PRE-FILTER] ${symbol} Phase 3: no dispatchable Gemini slot (busy/blocked/cooldown) — abort LLM`,
    detail: "phase3_no_dispatchable_slot",
  };
}

/** Mandatory sync gate immediately before tier-2 Gemini (cascade / tryGeminiFlow). */
export function assertLlmDispatchConvictionCeiling(params: {
  symbol: string;
  snapshot: IndicatorSnapshot;
  botSettingsRow?: Record<string, unknown> | null;
  tradeRegime?: TradeRegime;
  cycleMinAiConfidence?: number;
}): LlmGatekeeperPrefilterResult | null {
  return evaluateConvictionCeilingBlock(params);
}
