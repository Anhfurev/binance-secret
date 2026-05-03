// @ts-nocheck
/**
 * AI verdict + cache refresh. Sentiment “vibe” (Fear & Greed / news) applies a
 * scorecard ×0.7 haircut in `applySentimentVibeCheck` (`ai-core.ts`). Persisted
 * audit of pre- vs post-haircut weighted scores lives in `trades.ai_reasoning`
 * (`weighted_pre_sentiment_vibe`, `raw_weighted_confidence`, `effective_confidence`)
 * from `executeBuyFlow` → `buildAiReasoningJson` in `bot-buy.ts`.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import type { AiAnalysis, BotSettingsRow, IndicatorSnapshot } from "./types.ts";
import {
  activateGeminiQuotaCooldown,
  applySentimentVibeCheck,
  getAiAnalysis,
  getGeminiCooldownMsRemaining,
  getRecentAiCacheForSymbol,
  isGeminiInQuotaCooldown,
} from "./ai-core.ts";
import { getAiQuotaState, patchAiQuotaState } from "./ai-db.ts";
import { formatUnknownError, toNumber, toStringValue } from "./utils.ts";
import { getResolvedScoreWeightsPack } from "./ai-scoring.ts";
import { safeExecute } from "./safe-execute.ts";

// Only invoke Gemini when the price has moved at least this much since the
// previous AI check for this symbol. Lower values burn key quota on micro
// wiggles; higher values risk missing fast moves. 0.4% is a practical balance
// for BTC / SOL / PEPE on a 1m heartbeat cadence.
export const AI_PRICE_MOVE_THRESHOLD_PERCENT = 0.4;
const MAX_CONSECUTIVE_GEMINI_FAILURES = 3;
const EMERGENCY_ABORT_MESSAGE = "Emergency Abort: Quota Limit Hit";

export class EmergencyAbortQuotaError extends Error {
  constructor() {
    super("EMERGENCY_ABORT_QUOTA_LIMIT_HIT");
    this.name = "EmergencyAbortQuotaError";
  }
}

export function isEmergencyAbortQuotaError(error: unknown): boolean {
  return error instanceof EmergencyAbortQuotaError ||
    (error instanceof Error && error.message === "EMERGENCY_ABORT_QUOTA_LIMIT_HIT");
}

export function resetAiCycleGuards() {
  // State moved to DB-backed ai_quota_state.
}

export function shouldRunAiCheck(
  snapshot: IndicatorSnapshot,
  lastAiPriceBySymbol: Map<string, number>,
): boolean {
  if (snapshot.rsi > 70 || snapshot.rsi < 30) return true;
  const previousPrice = lastAiPriceBySymbol.get(snapshot.symbol);
  if (!previousPrice || previousPrice <= 0) return true;
  const movePct = Math.abs((snapshot.latestPrice - previousPrice) / previousPrice) * 100;
  return movePct > AI_PRICE_MOVE_THRESHOLD_PERCENT;
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
 * Tier bump for `risk_percent` only when no fixed USD size is set (> 0).
 * Caller must not null out `trade_size_usd` / `fixed_trade_usd` when applying the override.
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

export async function markAiQuotaFallback(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  symbol: string;
  detail: string;
}) {
  const { supabase, row, symbol, detail } = params;
  const botId = toStringValue((row as any)?.id);
  const userId = toStringValue((row as any)?.user_id);
  const cooldownMs = await getGeminiCooldownMsRemaining();
  const cooldownUntil = new Date(Date.now() + cooldownMs).toISOString();
  const nowIso = new Date().toISOString();
  const logResult = await supabase.from("logs").insert([{
    user_id: userId ?? null,
    symbol,
    level: "warn",
    source: "ai",
    message: "rate_limit_hit",
    meta: {
      event: "rate_limit_hit",
      provider: "gemini",
      use_fallback: true,
      bot_id: botId ?? null,
      cooldown_ms: cooldownMs,
      cooldown_until: cooldownUntil,
      detail,
    },
  }]);
  if (logResult.error) {
    console.error(`[binance-bot] failed to log rate_limit_hit: ${logResult.error.message}`);
  }
  const statusResult = await supabase.from("bot_settings").update({
    model_status: "OpenAI-Only",
    model_status_until: cooldownUntil,
    updated_at: nowIso,
    ai_cache_invalidate_until: cooldownUntil,
  } as any).eq("id", botId ?? "");
  if (statusResult.error) {
    console.warn(`[binance-bot] bot_settings model_status update skipped: ${statusResult.error.message}`);
  }
}

async function logEmergencyAbort(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  symbol: string;
  detail: string;
}) {
  const { supabase, row, symbol, detail } = params;
  const userId = toStringValue((row as any)?.user_id);
  const botId = toStringValue((row as any)?.id);
  const logResult = await supabase.from("logs").insert([{
    user_id: userId ?? null,
    symbol,
    level: "error",
    source: "ai",
    message: EMERGENCY_ABORT_MESSAGE,
    meta: {
      event: "emergency_abort_quota_limit_hit",
      provider: "gemini",
      bot_id: botId ?? null,
      consecutive_failures: (await getAiQuotaState())?.consecutive_gemini_failures ?? 0,
      detail,
    },
  }]);
  if (logResult.error) {
    console.error(`[binance-bot] failed to log emergency quota abort: ${logResult.error.message}`);
  }
}

async function registerGeminiFailureAndAbortIfNeeded(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  symbol: string;
  detail: string;
}) {
  const quota = await getAiQuotaState();
  const nextFailures = Number(quota?.consecutive_gemini_failures ?? 0) + 1;
  await patchAiQuotaState({
    consecutive_gemini_failures: nextFailures,
    last_failure_at: new Date().toISOString(),
  });
  if (nextFailures < MAX_CONSECUTIVE_GEMINI_FAILURES) return;
  await logEmergencyAbort(params);
  throw new EmergencyAbortQuotaError();
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
}): Promise<{ ai: AiAnalysis; aiQuotaFallback: boolean }> {
  const { shouldInvokeAi, snapshot, symbol, row, supabase, safetyAi, userId, signal } = params;
  let ai = safetyAi;
  let aiQuotaFallback = false;
  const shouldBypassCache = shouldBypassAiCacheFromSettings(row);
  const scoreWeights = getResolvedScoreWeightsPack(row as Record<string, unknown>);

  if (!shouldInvokeAi && !shouldBypassCache) {
    const recentCached = await getRecentAiCacheForSymbol(symbol);
    if (recentCached) {
      ai = await applySentimentVibeCheck(recentCached, snapshot, scoreWeights);
    }
    return { ai, aiQuotaFallback };
  }
  if (await isGeminiInQuotaCooldown()) {
    await registerGeminiFailureAndAbortIfNeeded({
      supabase,
      row,
      symbol,
      detail: "gemini_cooldown_active",
    });
    console.warn(`[AI DEBUG] Gemini cooldown active; fallback safety AI for ${symbol}`);
    return {
      ai: await applySentimentVibeCheck(
        withAiDebugTrace(ai, "fallback", "gemini_cooldown", shouldBypassCache),
        snapshot,
        scoreWeights,
      ),
      aiQuotaFallback: true,
    };
  }
  try {
    ai = await getAiAnalysis(snapshot, {
      skipCache: shouldBypassCache,
      cacheBypassReason: shouldBypassCache ? "settings_recently_changed" : undefined,
      scoreWeights,
      botSettingsRow: row as Record<string, unknown>,
      signal,
    });
    await patchAiQuotaState({ consecutive_gemini_failures: 0, last_failure_at: null });
    if (shouldBypassCache) {
      console.warn(`[AI DEBUG] Cache bypass for ${symbol}: ai_cache_invalidate_until is active`);
    }
  } catch (aiError) {
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
