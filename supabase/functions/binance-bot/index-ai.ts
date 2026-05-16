// @ts-nocheck
/**
 * AI verdict + cache refresh. Sentiment “vibe” (Fear & Greed / news) applies a
 * scorecard ×0.7 haircut in `applySentimentVibeCheck` (`ai-core.ts`). Persisted
 * audit of pre- vs post-haircut weighted scores lives in `trades.ai_reasoning`
 * (`weighted_pre_sentiment_vibe`, `raw_weighted_confidence`, `effective_confidence`)
 * from `executeBuyFlow` → `buildAiReasoningJson` in `bot-buy-v2.ts`.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import type { AiAnalysis, BotSettingsRow, IndicatorSnapshot } from "./types.ts";
import {
  activateGeminiQuotaCooldown,
  applySentimentVibeCheck,
  getAiAnalysis,
  getRecentAiCacheForSymbol,
} from "./ai-core.ts";
import { patchAiQuotaState } from "./ai-db.ts";
import { formatUnknownError, toNumber, toStringValue } from "./utils.ts";
import {
  markAiQuotaFallback,
  registerGeminiFailureAndAbortIfNeeded,
} from "./index-ai-quota-writes.ts";
import { getResolvedScoreWeightsPack } from "./ai-scoring.ts";
import { safeExecute } from "./safe-execute.ts";
import { applyStaleSignalBuyVeto } from "./ai-veto-helpers.ts";
import { withLlmConcurrency } from "./ai-llm-concurrency.ts";
import { isGeminiTerminalAuthError } from "./llm-key-backoff.ts";
import { clearCronBatchLlmKeyPools } from "./llm-key-preemptive-route.ts";
import { GLOBAL_BOT_CONFIG, IS_TEST_MODE } from "./config.ts";

// Only invoke Gemini when the price has moved at least this much since the
// previous AI check for this symbol. Lower values burn key quota on micro
// wiggles; higher values risk missing fast moves. 0.4% is a practical balance
// for BTC / SOL / PEPE on a 1m heartbeat cadence.
export function readAiPriceMoveThresholdPercent(): number {
  return GLOBAL_BOT_CONFIG.AI_PRICE_MOVE_THRESHOLD_PCT;
}

export function resetAiCycleGuards() {
  clearCronBatchLlmKeyPools();
}

export function shouldRunAiCheck(
  snapshot: IndicatorSnapshot,
  lastAiPriceBySymbol: Map<string, number>,
): boolean {
  if (IS_TEST_MODE) return true;
  if (snapshot.rsi > GLOBAL_BOT_CONFIG.AI_RUN_TRIGGER_RSI_HIGH ||
    snapshot.rsi < GLOBAL_BOT_CONFIG.AI_RUN_TRIGGER_RSI_LOW) return true;
  const previousPrice = lastAiPriceBySymbol.get(snapshot.symbol);
  if (!previousPrice || previousPrice <= 0) return true;
  const movePct = Math.abs((snapshot.latestPrice - previousPrice) / previousPrice) * 100;
  return movePct > readAiPriceMoveThresholdPercent();
}

/** True when UI or quota path set `ai_cache_invalidate_until` into the future. */
export function shouldBypassAiCacheFromSettings(row: BotSettingsRow): boolean {
  const raw = toStringValue((row as any)?.ai_cache_invalidate_until);
  if (!raw) return false;
  const untilMs = Date.parse(raw);
  if (!Number.isFinite(untilMs)) return false;
  return Date.now() < untilMs;
}

/**
 * Legacy tier bump for `risk_percent` (superseded by `trade-size-confidence.ts` sizing).
 * Kept for tests / callers that still read tier tables.
 */
export function resolveConfidenceTierRiskPercent(
  aiConfidence: number,
  row?: BotSettingsRow | null,
): number | null {
  if (!Number.isFinite(aiConfidence)) return null;
  const tradeSizeUsd = toNumber((row as any)?.trade_size_usd, 0);
  const fixedTradeUsd = toNumber((row as any)?.fixed_trade_usd, 0);
  if (tradeSizeUsd > 0 || fixedTradeUsd > 0) return null;
  if (aiConfidence > 85) return 5;
  if (aiConfidence >= 65) return 2;
  return null;
}

export async function getCachedSnapshot(
  cache: Map<string, IndicatorSnapshot>,
  symbol: string,
  fetchIndicatorSnapshot: (symbol: string, signal?: AbortSignal) => Promise<IndicatorSnapshot>,
  signal?: AbortSignal,
) {
  if (signal?.aborted) {
    throw new Error(`CYCLE_ABORTED:${symbol}`);
  }
  let snapshot = cache.get(symbol);
  if (!snapshot) {
    snapshot = await fetchIndicatorSnapshot(symbol, signal);
    cache.set(symbol, snapshot);
  }
  return snapshot;
}

export async function getAiVerdict(params: {
  shouldInvokeAi: boolean;
  snapshot: IndicatorSnapshot;
  symbol: string;
  row: BotSettingsRow;
  supabase: ReturnType<typeof createClient>;
  safetyAi: AiAnalysis;
  userId: string;
  signal?: AbortSignal;
  /** Paper drill: always fresh LLM read, no short-window cache reuse. */
  paperScenarioLiveAi?: boolean;
  /** Cron symbol index for multi-provider matrix routing. */
  symbolMatrixIndex?: number;
}): Promise<{ ai: AiAnalysis; aiQuotaFallback: boolean }> {
  const { shouldInvokeAi, snapshot, symbol, row, supabase, safetyAi, userId, signal } = params;
  const paperScenarioLiveAi = Boolean(params.paperScenarioLiveAi);
  let ai = safetyAi;
  let aiQuotaFallback = false;
  const shouldBypassCache = shouldBypassAiCacheFromSettings(row);
  const scoreWeights = getResolvedScoreWeightsPack(row as Record<string, unknown>);

  if (!shouldInvokeAi && !shouldBypassCache && !paperScenarioLiveAi) {
    const recentCached = await getRecentAiCacheForSymbol(symbol);
    if (recentCached) {
      const refreshed = applyStaleSignalBuyVeto(snapshot, recentCached);
      ai = await applySentimentVibeCheck(refreshed, snapshot, scoreWeights);
    }
    return { ai, aiQuotaFallback };
  }
  try {
    ai = await withLlmConcurrency(() =>
      getAiAnalysis(snapshot, {
        skipCache: shouldBypassCache || paperScenarioLiveAi,
        cacheBypassReason: shouldBypassCache
          ? "settings_recently_changed"
          : (paperScenarioLiveAi ? "paper_scenario_live_ai_drill" : undefined),
        scoreWeights,
        botSettingsRow: row as Record<string, unknown>,
        signal,
        symbolMatrixIndex: params.symbolMatrixIndex,
      })
    );
    await patchAiQuotaState({ consecutive_gemini_failures: 0, last_failure_at: null });
    if (shouldBypassCache) {
      console.warn(`[AI DEBUG] Cache bypass for ${symbol}: ai_cache_invalidate_until is active`);
    }
  } catch (aiError) {
    if (isGeminiTerminalAuthError(aiError)) throw aiError;
    const aiDetail = formatUnknownError(aiError);
    await safeExecute(
      "catch_ai_verdict_error_log",
      () =>
        supabase.from("logs").insert([{
          user_id: userId !== "unknown" ? userId : null,
          symbol,
          level: "warn",
          source: "ai",
          message: "ai_verdict_error_caught",
          meta: {
            event: "ai_verdict_error_caught",
            detail: aiDetail,
          },
          created_at: new Date().toISOString(),
        }]),
      undefined,
    );
    if (aiDetail.includes("QUOTA_EXHAUSTED")) {
      await activateGeminiQuotaCooldown();
      await markAiQuotaFallback({ supabase, row, symbol, detail: aiDetail });
      await registerGeminiFailureAndAbortIfNeeded({
        supabase,
        row,
        symbol,
        detail: aiDetail,
      });
      console.warn(`QUOTA_EXHAUSTED — safety AI for ${userId} ${symbol}: ${aiDetail}`);
      aiQuotaFallback = true;
      return {
        ai: await applySentimentVibeCheck(
          withAiDebugTrace(safetyAi, "fallback", "quota_exhausted", shouldBypassCache),
          snapshot,
          scoreWeights,
        ),
        aiQuotaFallback,
      };
    }
    console.error(`[AI DEBUG] getAiVerdict failed for ${symbol}: ${aiDetail}`, aiError);
    throw aiError;
  }
  return { ai, aiQuotaFallback };
}

function withAiDebugTrace(
  ai: AiAnalysis,
  provider: "fallback",
  providerPath: string,
  bypassed: boolean,
): AiAnalysis {
  return {
    ...ai,
    ai_provider: provider,
    ai_provider_path: providerPath,
    ai_cache_status: bypassed ? "bypassed" : "miss",
  };
}

export { EmergencyAbortQuotaError, isEmergencyAbortQuotaError } from "./index-ai-quota-writes.ts";
