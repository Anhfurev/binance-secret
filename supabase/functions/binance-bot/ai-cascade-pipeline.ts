// @ts-nocheck
import type { AiAnalysis, IndicatorSnapshot } from "./types.ts";
import type { GeminiKeySlot } from "./ai-keys.ts";
import { applyGroqBuyVeto } from "./ai-veto.ts";
import { getAiQuotaState, logGroqKeyLimit, logGroqKeySuccess, logGroqVeto, patchAiQuotaState } from "./ai-db.ts";
import {
  readGroqGatekeeperMinConfidence,
  readTier2GeminiMinConfidence,
} from "./ai-cascade-config.ts";
import { buildGeminiStructuralSummary } from "./ai-cascade-summary.ts";
import {
  buildAiIntervalGateLog,
  evaluateAiLlmOutboundGate,
} from "./ai-llm-interval-gate.ts";
import { assertLlmDispatchConvictionCeiling } from "./llm-gatekeeper-prefilter.ts";
import type { TradeRegime } from "./regime-scaling.ts";

export type CascadeGeminiRunner = (
  geminiSlots: GeminiKeySlot[],
  groqVetoKeys: string[],
  snapshot: IndicatorSnapshot,
  payload: unknown,
  symbol: string,
  signal?: AbortSignal,
  llmDb?: {
    groqVetoDbIds?: (string | undefined)[];
    groqVetoDbHardTimeoutMs?: number;
    geminiDbHardTimeoutMs?: number;
  },
  flowOpts?: {
    usePreemptiveKeyRouting?: boolean;
    dbBackedPool?: boolean;
    preferredGroqScanKeyIndex?: number;
    preferredGroqVetoKeyIndex?: number;
    preferredGeminiKeyIndex?: number;
    skipGroqVeto?: boolean;
  },
) => Promise<{ ai: AiAnalysis | null; primaryTimedOut?: boolean }>;

export type CascadeAiParams = {
  symbol: string;
  snapshot: IndicatorSnapshot;
  payload: unknown;
  geminiSlots: GeminiKeySlot[];
  groqVetoKeys: string[];
  groqVetoDbIds: (string | undefined)[];
  groqVetoDbErrorCounts?: (number | undefined)[];
  groqVetoDbStatuses?: import("./llm-api-keys-types.ts").LlmApiKeyRow["status"][];
  groqVetoDbCooldownUntils?: (string | null | undefined)[];
  groqDbHardCap?: number;
  geminiDbHardCap?: number;
  signal?: AbortSignal;
  llmFlowOpts: {
    usePreemptiveKeyRouting?: boolean;
    dbBackedPool?: boolean;
    preferredGroqScanKeyIndex?: number;
    preferredGroqVetoKeyIndex?: number;
    preferredGeminiKeyIndex?: number;
  };
  runGeminiTier: CascadeGeminiRunner;
  neutralFallback: () => AiAnalysis;
  withTrace: (
    ai: AiAnalysis,
    trace: { provider: "gemini" | "groq" | "fallback"; providerPath: string; cacheStatus: "miss" | "bypassed" },
  ) => AiAnalysis;
  /** Phases 1–3 passed — safe to log tier-2 scanner and call Gemini. */
  gatekeeperCleared?: boolean;
  botSettingsRow?: Record<string, unknown> | null;
  tradeRegime?: TradeRegime;
  llmDispatchConvictionFloor?: number;
};

function tier2MeetsBuyThreshold(ai: AiAnalysis): boolean {
  if (ai.is_setup_valid === false) return false;
  if (String(ai.action ?? "").toUpperCase() !== "BUY") return false;
  const conf = Number(ai.ai_confidence);
  return Number.isFinite(conf) && conf >= readTier2GeminiMinConfidence();
}

/** Tier 2 + 3 only (Tier 1 math guard runs in cycle-decider before getAiAnalysis). */
export async function runCascadeAiAnalysis(params: CascadeAiParams): Promise<AiAnalysis> {
  const {
    symbol,
    snapshot,
    payload,
    geminiSlots,
    groqVetoKeys,
    groqVetoDbIds,
    groqVetoDbErrorCounts,
    groqVetoDbStatuses,
    groqVetoDbCooldownUntils,
    groqDbHardCap,
    geminiDbHardCap,
    signal,
    llmFlowOpts,
    runGeminiTier,
    neutralFallback,
    withTrace,
    gatekeeperCleared = false,
    botSettingsRow,
    tradeRegime,
    llmDispatchConvictionFloor,
  } = params;

  if (!gatekeeperCleared) {
    console.log(
      `[PRE-FILTER] ${symbol} cascade blocked — gatekeeper not cleared (no gemini_scanner_start)`,
    );
    return withTrace(neutralFallback(), {
      provider: "fallback",
      providerPath: "cascade_gatekeeper_blocked",
      cacheStatus: "miss",
    });
  }

  const outboundGate = await evaluateAiLlmOutboundGate(symbol);
  if (!outboundGate.allowOutbound) {
    console.log(buildAiIntervalGateLog(symbol, outboundGate));
    const held = neutralFallback();
    held.action = "HOLD";
    return withTrace(held, {
      provider: "fallback",
      providerPath: "cascade_interval_gate_hold",
      cacheStatus: "miss",
    });
  }

  const convictionBlock = assertLlmDispatchConvictionCeiling({
    symbol,
    snapshot,
    botSettingsRow,
    tradeRegime,
    cycleMinAiConfidence: llmDispatchConvictionFloor,
  });
  if (convictionBlock) {
    if (convictionBlock.log) console.log(convictionBlock.log);
    console.log(
      `[PRE-FILTER] ${symbol} tier=2 BLOCKED short_circuit=true phase=2 (no gemini_scanner_start) detail=${convictionBlock.detail}`,
    );
    return withTrace(neutralFallback(), {
      provider: "fallback",
      providerPath: "cascade_conviction_ceiling_blocked",
      cacheStatus: "miss",
    });
  }

  console.log(`[AI FLOW] symbol=${symbol} tier=2 gemini_scanner_start`);

  const tier2 = await runGeminiTier(
    geminiSlots,
    groqVetoKeys,
    snapshot,
    payload,
    symbol,
    signal,
    {
      groqVetoDbIds,
      groqVetoDbHardTimeoutMs: groqDbHardCap,
      geminiDbHardTimeoutMs: geminiDbHardCap,
    },
    { ...llmFlowOpts, skipGroqVeto: true, skipConvictionRecheck: true },
  );

  if (!tier2.ai) {
    console.log(`[AI FLOW] symbol=${symbol} tier=2 gemini=miss final=HOLD`);
    const hold = withTrace(neutralFallback(), {
      provider: "fallback",
      providerPath: "cascade_tier2_gemini_exhausted",
      cacheStatus: "miss",
    });
    return hold;
  }

  let geminiAi = tier2.ai;
  if (!tier2MeetsBuyThreshold(geminiAi)) {
    const action = String(geminiAi.action ?? "HOLD").toUpperCase();
    console.log(
      `[AI FLOW] symbol=${symbol} tier=2 gemini=${action} conf=${Number(geminiAi.ai_confidence ?? 0)} final=HOLD short_circuit=true`,
    );
    return withTrace(geminiAi, {
      provider: "gemini",
      providerPath: String(geminiAi.ai_provider_path ?? "cascade_tier2_hold"),
      cacheStatus: "miss",
    });
  }

  console.log(
    `[AI FLOW] symbol=${symbol} tier=2 gemini=BUY conf=${Number(geminiAi.ai_confidence ?? 0)} tier=3 groq_gatekeeper_start`,
  );

  const quota = await getAiQuotaState();
  const structuralReasoning = buildGeminiStructuralSummary(geminiAi);
  const reviewed = await applyGroqBuyVeto({
    groqKeys: groqVetoKeys,
    snapshot,
    ai: geminiAi,
    symbol,
    currentGroqKeyIndex: Number(quota?.current_groq_key_index ?? 0),
    logGroqKeySuccess: (index) => logGroqKeySuccess(index, groqVetoKeys.length),
    logGroqKeyLimit: (index) => logGroqKeyLimit(index, groqVetoKeys.length),
    logGroqVeto,
    signal,
    groqDbKeyIds: groqVetoDbIds,
    groqDbKeyErrorCounts: groqVetoDbErrorCounts,
    groqDbKeyStatuses: groqVetoDbStatuses,
    groqDbKeyCooldownUntils: groqVetoDbCooldownUntils,
    groqDbHardTimeoutMs: groqDbHardCap,
    preferredGroqKeyIndex: llmFlowOpts.preferredGroqVetoKeyIndex,
    usePreemptiveKeyRouting: llmFlowOpts.usePreemptiveKeyRouting,
    skipInMemoryCooldownHint: llmFlowOpts.dbBackedPool,
    cascadeLean: true,
    geminiStructuralSummary: structuralReasoning,
  });
  geminiAi = reviewed.ai;

  if (!llmFlowOpts.usePreemptiveKeyRouting &&
    reviewed.nextGroqKeyIndex !== Number(quota?.current_groq_key_index ?? 0)) {
    await patchAiQuotaState({ current_groq_key_index: reviewed.nextGroqKeyIndex });
  }

  const groqVerdict = String(geminiAi.groq_verdict ?? "").toUpperCase();
  const gateMin = readGroqGatekeeperMinConfidence();
  const conf = Number(geminiAi.ai_confidence);
  if (
    groqVerdict === "APPROVE" &&
    geminiAi.action === "BUY" &&
    Number.isFinite(conf) &&
    conf < gateMin
  ) {
    geminiAi = {
      ...geminiAi,
      action: "HOLD",
      trend_alignment: false,
      groq_reason: `${geminiAi.groq_reason ?? ""}|below_gatekeeper_min_${gateMin}`.slice(0, 400),
    };
  }

  const path = groqVerdict === "REJECT"
    ? "cascade_tier3_groq_REJECT"
    : geminiAi.action === "BUY"
      ? "cascade_tier3_groq_BUY"
      : "cascade_tier3_groq_HOLD";

  console.log(
    `[AI FLOW] symbol=${symbol} tier=3 groq=${groqVerdict || "n/a"} action=${geminiAi.action} conf=${conf} final=${geminiAi.action}`,
  );
  console.log(`[BOT DEBUG] cascade_gatekeeper symbol=${symbol} path=${path} min_conf=${gateMin}`);

  return withTrace(geminiAi, { provider: "groq", providerPath: path, cacheStatus: "miss" });
}
