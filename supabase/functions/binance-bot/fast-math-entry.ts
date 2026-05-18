// @ts-nocheck
/** Sub-15ms math gate — RSI / BB / MACD on live snapshot (no LLM). */

import { checkEntryConditions } from "./strategy-entry-conditions.ts";
import type { BotSettingsRow, EntryCheckResult, IndicatorSnapshot } from "./types.ts";

const BOUNCE_REASON = "strategy_oversold_bounce_entry";

export function evaluateFastMathBounceEntry(
  snapshot: IndicatorSnapshot,
  botSettings?: BotSettingsRow | null,
): EntryCheckResult | null {
  const started = performance.now();
  const entry = checkEntryConditions(snapshot, { botSettings: botSettings ?? undefined });
  if (entry.signal !== "BUY" || entry.strategy_reason !== BOUNCE_REASON) {
    return null;
  }
  const macd = snapshot.macd ?? { macd: 0, signal: 0, histogram: 0 };
  const hist = Number(macd.histogram ?? 0);
  const line = Number(macd.macd ?? 0);
  const sig = Number(macd.signal ?? 0);
  const macdOk = hist >= -1e-9 || line >= sig * 0.998;
  if (!macdOk) {
    return null;
  }
  const elapsed = performance.now() - started;
  if (elapsed > 15) {
    console.warn(`[FAST_MATH] bounce_eval slow ${elapsed.toFixed(1)}ms symbol=${snapshot.symbol}`);
  }
  return entry;
}

export function buildFastLaneAiStub(confidence = 68): import("./types.ts").AiAnalysis {
  return {
    action: "BUY",
    ai_confidence: confidence,
    trend: "neutral",
    trend_alignment: true,
    reason: "fast_math_bounce_lane",
    structural_reasoning: "strategy_oversold_bounce_entry|fast_lane_no_llm",
    provider_path: "fast_math_bounce",
  };
}
