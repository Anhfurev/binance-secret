// @ts-nocheck
import type { AiAnalysis, IndicatorSnapshot } from "./types.ts";
import { type GeminiKeySlot } from "./ai-keys.ts";
import {
  readLlmApiKeysDbHardTimeoutMs,
  recordLlmApiKeyHttpFailure,
  touchLlmApiKeyUsed,
} from "./llm-api-keys-repo.ts";
import {
  resolveGeminiSlotsForRuntime,
  resolveGroqKeyPlanForRuntime,
} from "./llm-api-keys-resolve.ts";
import { isLlmHttpError } from "./llm-http-error.ts";
import {
  getAiQuotaState,
  getRecentAiCache,
  logAiCacheHit,
  logGeminiKeyLimit,
  logGeminiKeySuccess,
  logGroqKeyLimit,
  logGroqKeySuccess,
  logGroqVeto,
  patchAiQuotaState,
  saveAiCache,
} from "./ai-db.ts";
import {
  geminiAnalyze,
  groqAnalyze,
  openAiAnalyze,
} from "./ai-models.ts";
import { applyGroqBuyVeto, buildSymbolStrategyHint } from "./ai-veto.ts";
import {
  applyStaleSignalBuyVeto,
  hasFinalGroqBuyVeto,
} from "./ai-veto-helpers.ts";
import {
  getMultiSymbolBatchProvider,
  takeMultiSymbolBatchAi,
} from "./ai-multi-symbol-batch-store.ts";
import {
  collectSentimentVibe,
  isExtremeFearFng,
} from "./sentiment-check.ts";
import {
  computeWeightedConfidence,
  computeWeightedConfidenceForRegime,
  type ScoreWeightsRecord,
} from "./ai-scoring.ts";
import { resolvePortfolioBasketHint } from "./portfolio-basket.ts";
import {
  GEMINI_QUOTA_COOLDOWN_MS,
  hasAnyAvailableGeminiKey,
  isGeminiKeyAvailable,
  isPermanentCredentialOrSuspension,
  isSoftQuotaOrRateLimit,
  readGeminiAuthKeyCooldownMs,
  resolveLlmKeyFailureCooldownMs,
} from "./llm-key-backoff.ts";
import { resolveGroqKeyFailureCooldownMs } from "./groq-key-failure-cooldown.ts";
import {
  readAiProviderMatrixEnabled,
  resolveMatrixFallbackProvider,
  resolveMatrixPrimaryProvider,
} from "./ai-provider-matrix.ts";
import {
  enforceCrossProviderFallbackGap,
  readGroqToGeminiFallbackGapMs,
} from "./groq-request-spacing.ts";
import { GLOBAL_BOT_CONFIG } from "./config.ts";
import { readAiPrimaryLlmIsGroq, readAiSkipGemini } from "./ai-llm-route.ts";
import {
  buildPreemptiveRotationOrder,
  buildQuotaRotationOrder,
  getCronBatchLlmKeyPools,
  resolvePreemptiveKeyIndex,
  shouldPreemptiveRouteForSymbolIndex,
} from "./llm-key-preemptive-route.ts";
import {
  candlesToLlmTuples,
  pickOneMinuteTape,
  readAiLlmBarLimits,
  readAiLlmIncludeScoringRubric,
  tailCandles,
} from "./ai-payload-slim.ts";

export { GEMINI_QUOTA_COOLDOWN_MS };

function isAbortOrTimeoutError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  const m = String((error as Error)?.message ?? error).toLowerCase();
  return m.includes("abort") || m.includes("timeout");
}

const AI_STALE_CACHE_FALLBACK_MS = 2 * 60 * 1000;
const AI_UNAVAILABLE_LOG = "AI currently unavailable - switching to Technical-Only mode.";
const SAFETY_LIMIT_FALLBACK = { signal: "HOLD", confidence: 100, reason: "limit_fallback" } as const;

/** BUY scorecard × 0.7 when Fear & Greed is extreme fear or CryptoPanic hack-style headline (24h). */
const SENTIMENT_BUY_PENALTY_FACTOR = 0.7;

export async function isGeminiInQuotaCooldown() {
  const quota = await getAiQuotaState();
  if (!quota?.gemini_cooldown_until) return false;
  const until = Date.parse(quota.gemini_cooldown_until);
  return Number.isFinite(until) && Date.now() < until;
}
export async function activateGeminiQuotaCooldown() {
  await patchAiQuotaState({
    gemini_cooldown_until: new Date(Date.now() + GEMINI_QUOTA_COOLDOWN_MS).toISOString(),
  });
}
export async function getGeminiCooldownMsRemaining() {
  const quota = await getAiQuotaState();
  if (!quota?.gemini_cooldown_until) return 0;
  const until = Date.parse(quota.gemini_cooldown_until);
  if (!Number.isFinite(until)) return 0;
  return Math.max(0, until - Date.now());
}

/**
 * Post-model "vibe check": attaches `sentiment_vibe`; for `action === "BUY"` may scale
 * all four sub-scores by 0.7 when extreme fear (Alternative.me) or hack-style news (optional CryptoPanic).
 */
function regimeResolvedWeights(
  regime: IndicatorSnapshot["marketRegime"],
  pack?: { tf: ScoreWeightsRecord; mr: ScoreWeightsRecord } | null,
): ScoreWeightsRecord | null {
  if (!pack) return null;
  return regime === "RANGING" ? pack.mr : pack.tf;
}

export async function applySentimentVibeCheck(
  ai: AiAnalysis,
  snapshot: IndicatorSnapshot,
  scoreWeightsPack?: { tf: ScoreWeightsRecord; mr: ScoreWeightsRecord } | null,
  prefetchedMeta?: Awaited<ReturnType<typeof collectSentimentVibe>>,
): Promise<AiAnalysis> {
  const rw = regimeResolvedWeights(snapshot.marketRegime, scoreWeightsPack);
  const meta = prefetchedMeta ?? await collectSentimentVibe(snapshot.symbol);
  const attachOnly = (penalty: boolean, factor: number): AiAnalysis => {
    const next: AiAnalysis = {
      ...ai,
      sentiment_vibe: {
        ...meta,
        penalty_applied: penalty,
        penalty_factor: factor,
      },
    };
    next.ai_confidence = computeWeightedConfidenceForRegime(
      next,
      snapshot.marketRegime,
      rw,
    );
    return next;
  };

  if (ai.action !== "BUY") {
    return attachOnly(false, 1);
  }
  const hack = Boolean(meta.hack_major_alert);
  const fgVal = meta.fear_greed_value;
  /** Fear and Greed under 20: contrarian bounce zone — no scorecard haircut (hacks still penalized). */
  if (
    typeof fgVal === "number" &&
    Number.isFinite(fgVal) &&
    fgVal < 20 &&
    !hack
  ) {
    return attachOnly(false, 1);
  }
  const extreme = isExtremeFearFng(meta.fear_greed_value, meta.fear_greed_label);
  if (!extreme && !hack) {
    return attachOnly(false, 1);
  }

  const f = SENTIMENT_BUY_PENALTY_FACTOR;
  const scaled: AiAnalysis = {
    ...ai,
    trend_score: Math.round(Number(ai.trend_score ?? 0) * f * 100) / 100,
    momentum_score: Math.round(Number(ai.momentum_score ?? 0) * f * 100) / 100,
    volume_score: Math.round(Number(ai.volume_score ?? 0) * f * 100) / 100,
    order_book_score: Math.round(Number(ai.order_book_score ?? 0) * f * 100) / 100,
    sentiment_vibe: {
      ...meta,
      penalty_applied: true,
      penalty_factor: f,
    },
  };
  scaled.ai_confidence = computeWeightedConfidenceForRegime(
    scaled,
    snapshot.marketRegime,
    rw,
  );
  return scaled;
}

export async function getAiAnalysis(
  snapshot: IndicatorSnapshot,
  options?: {
    skipCache?: boolean;
    cacheBypassReason?: string;
    scoreWeights?: { tf: ScoreWeightsRecord; mr: ScoreWeightsRecord } | null;
    /** Passed into DATA.portfolio_basket_hint (tier / weight from DB or defaults). */
    botSettingsRow?: Record<string, unknown> | null;
    signal?: AbortSignal;
    /** Cron batch position for multi-provider matrix (0=BTC Groq-first, 1=SOL Gemini-first, …). */
    symbolMatrixIndex?: number;
  },
): Promise<AiAnalysis> {
  const symbol = String(snapshot.symbol || "BTCUSDT").toUpperCase();
  const batchPools = getCronBatchLlmKeyPools();
  const groqPlan = batchPools?.groqPlan ?? await resolveGroqKeyPlanForRuntime();
  const geminiSlots = batchPools?.geminiSlots ?? await resolveGeminiSlotsForRuntime();
  const groqScanKeys = groqPlan.scanKeys;
  const groqVetoKeys = groqPlan.vetoKeys;
  const groqScanDbIds = groqPlan.scanDbIds;
  const groqVetoDbIds = groqPlan.vetoDbIds;
  const groqDbHardCap = groqPlan.useDbHardTimeout ? readLlmApiKeysDbHardTimeoutMs() : undefined;
  const geminiDbHardCap = geminiSlots.some((s) => Boolean(s.llmDbKeyId))
    ? readLlmApiKeysDbHardTimeoutMs()
    : undefined;
  const llmGroqCtx = groqPlan.useDbHardTimeout && groqDbHardCap != null
    ? {
      scanRowIds: groqScanDbIds,
      scanHardTimeoutMs: groqDbHardCap,
      vetoRowIds: groqVetoDbIds,
      vetoHardTimeoutMs: groqDbHardCap,
    }
    : undefined;
  const llmGeminiCtx = geminiDbHardCap != null
    ? {
      groqVetoDbIds,
      groqVetoDbHardTimeoutMs: groqDbHardCap,
      geminiDbHardTimeoutMs: geminiDbHardCap,
    }
    : undefined;
  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const payload = buildPayload(
    snapshot,
    symbol,
    options?.botSettingsRow ?? null,
  );
  const shouldBypassCache = Boolean(options?.skipCache);
  const sw = options?.scoreWeights ?? null;
  const matrixIndex = options?.symbolMatrixIndex;
  const useProviderMatrix =
    readAiProviderMatrixEnabled() &&
    matrixIndex != null &&
    Number.isFinite(matrixIndex) &&
    matrixIndex >= 0;
  const usePreemptiveKeys = shouldPreemptiveRouteForSymbolIndex(matrixIndex);
  const preferredGroqScanIdx = usePreemptiveKeys && groqScanKeys.length
    ? resolvePreemptiveKeyIndex(matrixIndex!, groqScanKeys.length)
    : undefined;
  const preferredGroqVetoIdx = usePreemptiveKeys && groqVetoKeys.length
    ? resolvePreemptiveKeyIndex(matrixIndex!, groqVetoKeys.length)
    : undefined;
  const preferredGeminiIdx = usePreemptiveKeys && geminiSlots.length
    ? resolvePreemptiveKeyIndex(matrixIndex!, geminiSlots.length)
    : undefined;
  const skipInMemoryKeyCooldowns = usePreemptiveKeys && groqPlan.useDbHardTimeout;
  const groqVetoBase = {
    groqKeys: groqVetoKeys,
    snapshot,
    symbol,
    logGroqKeySuccess: (index: number) => logGroqKeySuccess(index, groqVetoKeys.length),
    logGroqKeyLimit: (index: number) => logGroqKeyLimit(index, groqVetoKeys.length),
    logGroqVeto,
    signal: options?.signal,
    groqDbKeyIds: groqVetoDbIds,
    groqDbHardTimeoutMs: groqDbHardCap,
    preferredGroqKeyIndex: preferredGroqVetoIdx,
    usePreemptiveKeyRouting: usePreemptiveKeys,
    skipInMemoryCooldownHint: skipInMemoryKeyCooldowns,
  };
  const llmFlowOpts = {
    usePreemptiveKeyRouting: usePreemptiveKeys,
    dbBackedPool: groqPlan.useDbHardTimeout,
    preferredGroqScanKeyIndex: preferredGroqScanIdx,
    preferredGroqVetoKeyIndex: preferredGroqVetoIdx,
    preferredGeminiKeyIndex: preferredGeminiIdx,
  };

  if (!shouldBypassCache) {
    const cached = await getRecentAiCache(symbol, GLOBAL_BOT_CONFIG.AI_CACHE_WINDOW_MS);
    if (cached) {
      const ageSeconds = Math.max(0, Math.round(cached.ageMs / 1000));
      await logAiCacheHit(symbol, cached.ageMs);
      const quota = await getAiQuotaState();
      let analysis = applyStaleSignalBuyVeto(snapshot, cached.analysis);
      if (analysis.action === "BUY" && !hasFinalGroqBuyVeto(analysis) && GLOBAL_BOT_CONFIG.GROQ_VETO_ON_CACHE_HIT) {
        const reviewed = await applyGroqBuyVeto({
          ...groqVetoBase,
          ai: analysis,
          currentGroqKeyIndex: Number(quota?.current_groq_key_index ?? 0),
          groqKeyCooldownsHint: skipInMemoryKeyCooldowns ? {} : (quota?.groq_key_cooldowns ?? {}),
        });
        analysis = reviewed.ai;
        if (!usePreemptiveKeys && reviewed.nextGroqKeyIndex !== Number(quota?.current_groq_key_index ?? 0)) {
          await patchAiQuotaState({ current_groq_key_index: reviewed.nextGroqKeyIndex });
        }
      }
      return await applySentimentVibeCheck(
        withAiTrace(analysis, {
          provider: "cache",
          providerPath: `cache_hit_${ageSeconds}s`,
          cacheStatus: "hit",
          cacheAgeMs: cached.ageMs,
        }),
        snapshot,
        sw,
      );
    }
  } else {
    console.log(`[Cache Bypass] ${symbol} reason=${options?.cacheBypassReason ?? "manual_bypass"}`);
  }

  const sentimentPrefetch = collectSentimentVibe(snapshot.symbol);
  const llmBatched = !shouldBypassCache && !useProviderMatrix
    ? takeMultiSymbolBatchAi(symbol)
    : null;
  if (llmBatched) {
    const quota = await getAiQuotaState();
    let analysis = llmBatched;
    if (analysis.action === "BUY" && !hasFinalGroqBuyVeto(analysis)) {
      const reviewed = await applyGroqBuyVeto({
        ...groqVetoBase,
        ai: analysis,
        currentGroqKeyIndex: Number(quota?.current_groq_key_index ?? 0),
        groqKeyCooldownsHint: skipInMemoryKeyCooldowns ? {} : (quota?.groq_key_cooldowns ?? {}),
      });
      analysis = reviewed.ai;
      if (!usePreemptiveKeys && reviewed.nextGroqKeyIndex !== Number(quota?.current_groq_key_index ?? 0)) {
        await patchAiQuotaState({ current_groq_key_index: reviewed.nextGroqKeyIndex });
      }
    }
    await saveAiCache(symbol, analysis);
    const batchProv = getMultiSymbolBatchProvider() ?? "groq";
    const batchPath =
      batchProv === "gemini"
        ? "gemini_multi_symbol_batch"
        : "groq_multi_symbol_batch";
    return await applySentimentVibeCheck(
      withAiTrace(analysis, {
        provider: batchProv,
        providerPath: batchPath,
        cacheStatus: shouldBypassCache ? "bypassed" : "miss",
      }),
      snapshot,
      sw,
      await sentimentPrefetch,
    );
  }

  const skipGemini = readAiSkipGemini();
  const groqFirst = useProviderMatrix
    ? resolveMatrixPrimaryProvider(matrixIndex!) === "groq"
    : readAiPrimaryLlmIsGroq();
  if (useProviderMatrix) {
    const primary = resolveMatrixPrimaryProvider(matrixIndex!);
    const fallback = resolveMatrixFallbackProvider(matrixIndex!);
    console.log(
      `[AI MATRIX] ${symbol} idx=${matrixIndex} primary=${primary} fallback=${fallback} groq_key=${
        preferredGroqScanIdx != null ? preferredGroqScanIdx + 1 : "—"
      }/${groqScanKeys.length} gemini_key=${
        preferredGeminiIdx != null ? preferredGeminiIdx + 1 : "—"
      }/${geminiSlots.length}`,
    );
  }
  if (groqFirst) {
    const groqPrimary = await tryGroqFlow(
      groqScanKeys,
      groqVetoKeys,
      snapshot,
      payload,
      symbol,
      options?.signal,
      llmGroqCtx,
      llmFlowOpts,
    );
    if (groqPrimary.ai) {
      return await applySentimentVibeCheck(groqPrimary.ai, snapshot, sw);
    }
    if (!skipGemini) {
      const quotaHint = await getAiQuotaState();
      const gemKeyValues = geminiSlots.map((s) => s.value);
      const gemCooldowns = skipInMemoryKeyCooldowns ? {} : (quotaHint?.gemini_key_cooldowns ?? {});
      const geminiPoolHealthy = skipInMemoryKeyCooldowns || hasAnyAvailableGeminiKey(gemKeyValues, gemCooldowns);
      if (groqPrimary.groqQuotaExhausted && !geminiPoolHealthy) {
        console.warn(
          `[AI DEBUG] ${symbol}: Groq 429 but all Gemini keys benched — skip Gemini fallback (no 403 flood)`,
        );
      } else {
      if (groqPrimary.groqQuotaExhausted) {
        console.warn(
          `[AI DEBUG] Groq 429/quota for ${symbol} — skipping inter-provider gap (fast-fail; was ${readGroqToGeminiFallbackGapMs()}ms)`,
        );
      }
      const geminiFallback = await tryGeminiFlow(
        geminiSlots,
        groqVetoKeys,
        snapshot,
        payload,
        symbol,
        options?.signal,
        llmGeminiCtx,
        llmFlowOpts,
      );
      if (geminiFallback) {
        return await applySentimentVibeCheck(
          geminiFallback,
          snapshot,
          sw,
          await sentimentPrefetch,
        );
      }
      }
    }
  } else {
    if (!skipGemini) {
      const geminiResult = await tryGeminiFlow(
        geminiSlots,
        groqVetoKeys,
        snapshot,
        payload,
        symbol,
        options?.signal,
        llmGeminiCtx,
        llmFlowOpts,
      );
      if (geminiResult) {
        return await applySentimentVibeCheck(
          geminiResult,
          snapshot,
          sw,
          await sentimentPrefetch,
        );
      }
      if (useProviderMatrix) {
        console.warn(
          `[AI MATRIX] ${symbol} Gemini primary miss — cross-provider gap before Groq`,
        );
        await enforceCrossProviderFallbackGap(options?.signal);
      }
    }
    const groqResult = await tryGroqFlow(
      groqScanKeys,
      groqVetoKeys,
      snapshot,
      payload,
      symbol,
      options?.signal,
      llmGroqCtx,
      llmFlowOpts,
    );
    if (groqResult.ai) {
      return await applySentimentVibeCheck(groqResult.ai, snapshot, sw);
    }
  }

  if (openaiKey) {
    try {
      const openAiResult = await openAiAnalyze(openaiKey, payload, options?.signal);
      return await applySentimentVibeCheck(
        withAiTrace(openAiResult, {
          provider: "openai",
          providerPath: "openai_success",
          cacheStatus: shouldBypassCache ? "bypassed" : "miss",
        }),
        snapshot,
        sw,
      );
    } catch (error) {
      console.error("OpenAI Failure:", error instanceof Error ? error.message : String(error));
      console.log(AI_UNAVAILABLE_LOG);
      return await applySentimentVibeCheck(buildNeutralFallback(), snapshot, sw);
    }
  }
  return await applySentimentVibeCheck(buildNeutralFallback(), snapshot, sw);
}

export async function getRecentAiCacheForSymbol(symbol: string): Promise<AiAnalysis | null> {
  const cached = await getRecentAiCache(symbol.toUpperCase(), GLOBAL_BOT_CONFIG.AI_CACHE_WINDOW_MS);
  if (!cached) return null;
  const ageSeconds = Math.max(0, Math.round(cached.ageMs / 1000));
  return withAiTrace(cached.analysis, {
    provider: "cache",
    providerPath: `cache_hit_${ageSeconds}s`,
    cacheStatus: "hit",
    cacheAgeMs: cached.ageMs,
  });
}

function geminiSlotLabel(slot: GeminiKeySlot, keyIndex: number, nKeys: number): string {
  return `${slot.label} (slot ${keyIndex + 1}/${nKeys})`;
}

type LlmGeminiFlowDbCtx = {
  groqVetoDbIds?: (string | undefined)[];
  groqVetoDbHardTimeoutMs?: number;
  geminiDbHardTimeoutMs?: number;
};

type LlmFlowPreemptiveOpts = {
  usePreemptiveKeyRouting?: boolean;
  dbBackedPool?: boolean;
  preferredGroqScanKeyIndex?: number;
  preferredGroqVetoKeyIndex?: number;
  preferredGeminiKeyIndex?: number;
};

async function tryGeminiFlow(
  geminiSlots: GeminiKeySlot[],
  groqVetoKeys: string[],
  snapshot: IndicatorSnapshot,
  payload: unknown,
  symbol: string,
  signal?: AbortSignal,
  llmDb?: LlmGeminiFlowDbCtx,
  flowOpts?: LlmFlowPreemptiveOpts,
) {
  const geminiKeys = geminiSlots.map((s) => s.value);
  if (geminiKeys.length === 0) return null;
  const quota = await getAiQuotaState();
  const usePreemptive = Boolean(
    flowOpts?.usePreemptiveKeyRouting &&
      flowOpts.preferredGeminiKeyIndex != null &&
      geminiKeys.length > 0,
  );
  const skipInMemoryCooldowns = usePreemptive && Boolean(flowOpts?.dbBackedPool);
  let mergedCooldowns: Record<string, number> = skipInMemoryCooldowns
    ? {}
    : { ...(quota?.gemini_key_cooldowns ?? {}) };
  const baseIndex = Number.isFinite(Number(quota?.current_gemini_key_index))
    ? Number(quota?.current_gemini_key_index)
    : 0;
  const nKeys = geminiKeys.length;
  const rotationOrder = usePreemptive
    ? buildPreemptiveRotationOrder(flowOpts!.preferredGeminiKeyIndex!, nKeys)
    : buildQuotaRotationOrder(baseIndex, nKeys);
  if (!skipInMemoryCooldowns && !hasAnyAvailableGeminiKey(geminiKeys, mergedCooldowns)) {
    console.warn(`[AI DEBUG] All Gemini keys benched in DB for ${symbol} — skip live Gemini fetch`);
    return null;
  }
  const maxGeminiFetches = GLOBAL_BOT_CONFIG.GEMINI_MAX_KEY_ATTEMPTS_PER_CALL;
  let geminiFetchAttempts = 0;
  const preferredGeminiIdx = flowOpts?.preferredGeminiKeyIndex;
  for (const keyIndex of rotationOrder) {
    const key = geminiKeys[keyIndex];
    const slot = geminiSlots[keyIndex];
    const isAssignedPreemptiveKey = usePreemptive && keyIndex === preferredGeminiIdx;
    if (!isGeminiKeyAvailable(key, mergedCooldowns) && !isAssignedPreemptiveKey) {
      console.warn(
        `[AI DEBUG] Gemini ${geminiSlotLabel(slot, keyIndex, nKeys)} benched — skip slot`,
      );
      continue;
    }
    if (geminiFetchAttempts >= maxGeminiFetches) {
      console.warn(
        `[AI DEBUG] Gemini key attempt cap (${maxGeminiFetches}) reached for ${symbol} — stopping rotation (pool health)`,
      );
      break;
    }
    geminiFetchAttempts += 1;
    try {
      const gemOpts = llmDb?.geminiDbHardTimeoutMs != null
        ? { dbHardTimeoutMs: llmDb.geminiDbHardTimeoutMs }
        : undefined;
      const fresh = await geminiAnalyze(key, payload, signal, symbol, gemOpts);
      const reviewed = fresh.action === "BUY"
        ? await applyGroqBuyVeto({
          groqKeys: groqVetoKeys,
          snapshot,
          ai: fresh,
          symbol,
          currentGroqKeyIndex: Number(quota?.current_groq_key_index ?? 0),
          logGroqKeySuccess: (index) => logGroqKeySuccess(index, groqVetoKeys.length),
          logGroqKeyLimit: (index) => logGroqKeyLimit(index, groqVetoKeys.length),
          logGroqVeto,
          signal,
          groqKeyCooldownsHint: skipInMemoryCooldowns ? {} : (quota?.groq_key_cooldowns ?? {}),
          groqDbKeyIds: llmDb?.groqVetoDbIds,
          groqDbHardTimeoutMs: llmDb?.groqVetoDbHardTimeoutMs,
          preferredGroqKeyIndex: flowOpts?.preferredGroqVetoKeyIndex,
          usePreemptiveKeyRouting: usePreemptive,
          skipInMemoryCooldownHint: skipInMemoryCooldowns,
        })
        : { ai: fresh, nextGroqKeyIndex: Number(quota?.current_groq_key_index ?? 0) };
      const quotaPatch: Record<string, unknown> = { current_gemini_key_index: keyIndex };
      if (!usePreemptive) quotaPatch.current_groq_key_index = reviewed.nextGroqKeyIndex;
      await patchAiQuotaState(quotaPatch);
      await logGeminiKeySuccess(keyIndex, geminiKeys.length);
      if (slot.llmDbKeyId) await touchLlmApiKeyUsed(slot.llmDbKeyId);
      await saveAiCache(symbol, reviewed.ai);
      return withAiTrace(reviewed.ai, {
        provider: "gemini",
        providerPath: `gemini_key_${keyIndex + 1}_success`,
        cacheStatus: "miss",
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (slot.llmDbKeyId && (isLlmHttpError(error) || isSoftQuotaOrRateLimit(msg) || isAbortOrTimeoutError(error))) {
        await recordLlmApiKeyHttpFailure(slot.llmDbKeyId, error, {
          provider: "gemini",
          keyIndex,
          symbol,
        });
      }
      if (isPermanentCredentialOrSuspension(msg)) {
        const benchMs = readGeminiAuthKeyCooldownMs();
        await logGeminiKeyLimit(keyIndex, geminiKeys.length);
        mergedCooldowns = {
          ...mergedCooldowns,
          [key]: Date.now() + benchMs,
        };
        await patchAiQuotaState({
          gemini_key_cooldowns: mergedCooldowns,
          current_gemini_key_index: keyIndex,
        });
        console.warn(
          `[AI DEBUG] Gemini ${geminiSlotLabel(slot, keyIndex, nKeys)} terminal auth — benched ${Math.round(benchMs / 3600000)}h, try next key (${msg.slice(0, 120)})`,
        );
        continue;
      }
      const backoffMs = resolveLlmKeyFailureCooldownMs(msg);
      if (backoffMs != null) {
        await logGeminiKeyLimit(keyIndex, geminiKeys.length);
        mergedCooldowns = {
          ...mergedCooldowns,
          [key]: Date.now() + backoffMs,
        };
        await patchAiQuotaState({
          gemini_key_cooldowns: mergedCooldowns,
          current_gemini_key_index: keyIndex,
        });
        console.warn(
          `[AI DEBUG] Gemini ${geminiSlotLabel(slot, keyIndex, nKeys)} moved to cooldown (${msg.slice(0, 120)})`,
        );
        if (isSoftQuotaOrRateLimit(msg)) {
          console.warn(
            `[AI DEBUG] Gemini quota circuit for ${symbol} — stop key rotation this invocation`,
          );
          break;
        }
        continue;
      }
      if (isAbortOrTimeoutError(error)) {
        console.warn(
          `[AI DEBUG] Gemini timeout/abort ${geminiSlotLabel(slot, keyIndex, nKeys)} for ${symbol} — trying next key`,
        );
        continue;
      }
      console.error("Gemini Failure:", msg);
      break;
    }
  }
  const staleCached = await getRecentAiCache(symbol, AI_STALE_CACHE_FALLBACK_MS);
  if (staleCached) {
    const ageSeconds = Math.max(0, Math.round(staleCached.ageMs / 1000));
    await logAiCacheHit(symbol, staleCached.ageMs);
    const analysis = applyStaleSignalBuyVeto(snapshot, staleCached.analysis);
    return withAiTrace(analysis, {
      provider: "cache",
      providerPath: `cache_stale_fallback_${ageSeconds}s`,
      cacheStatus: "bypassed",
      cacheAgeMs: staleCached.ageMs,
    });
  }
  return null;
}

type GroqFlowResult = { ai: AiAnalysis | null; groqQuotaExhausted: boolean };

type LlmGroqFlowDbCtx = {
  scanRowIds?: (string | undefined)[];
  scanHardTimeoutMs?: number;
  vetoRowIds?: (string | undefined)[];
  vetoHardTimeoutMs?: number;
};

async function tryGroqFlow(
  groqScanKeys: string[],
  groqVetoKeys: string[],
  snapshot: IndicatorSnapshot,
  payload: unknown,
  symbol: string,
  signal?: AbortSignal,
  llmDb?: LlmGroqFlowDbCtx,
  flowOpts?: LlmFlowPreemptiveOpts,
): Promise<GroqFlowResult> {
  const quota = await getAiQuotaState();
  if (groqScanKeys.length === 0) return { ai: null, groqQuotaExhausted: false };
  let groqQuotaExhausted = false;
  const usePreemptive = Boolean(
    flowOpts?.usePreemptiveKeyRouting &&
      flowOpts.preferredGroqScanKeyIndex != null &&
      groqScanKeys.length > 0,
  );
  const skipInMemoryCooldowns = usePreemptive && Boolean(flowOpts?.dbBackedPool);
  let mergedCooldowns: Record<string, number> = skipInMemoryCooldowns
    ? {}
    : { ...(quota?.groq_key_cooldowns ?? {}) };
  if (!skipInMemoryCooldowns && getAvailableKeyEntries(groqScanKeys, mergedCooldowns).length === 0) {
    console.warn(`[AI DEBUG] All Groq scan keys cooling down for ${symbol}; waiting refresh window`);
    return { ai: null, groqQuotaExhausted };
  }
  const scanBase = Number.isFinite(Number(quota?.current_groq_scan_key_index))
    ? Number(quota.current_groq_scan_key_index)
    : 0;
  const nScan = groqScanKeys.length;
  const rotationOrder = usePreemptive
    ? buildPreemptiveRotationOrder(flowOpts!.preferredGroqScanKeyIndex!, nScan)
    : buildQuotaRotationOrder(scanBase, nScan);
  const preferredScanIdx = flowOpts?.preferredGroqScanKeyIndex;
  for (const keyIndex of rotationOrder) {
    const key = groqScanKeys[keyIndex];
    const isAssignedPreemptiveKey = usePreemptive && keyIndex === preferredScanIdx;
    if (Number(mergedCooldowns[key] ?? 0) > Date.now() && !isAssignedPreemptiveKey) continue;
    try {
      const gopts = llmDb?.scanHardTimeoutMs != null
        ? { dbHardTimeoutMs: llmDb.scanHardTimeoutMs }
        : undefined;
      const groqResult = await groqAnalyze(key, payload, signal, symbol, gopts);
      const reviewed = groqResult.action === "BUY"
        ? await applyGroqBuyVeto({
          groqKeys: groqVetoKeys,
          snapshot,
          ai: groqResult,
          symbol,
          currentGroqKeyIndex: Number(quota?.current_groq_key_index ?? 0),
          logGroqKeySuccess: (index) => logGroqKeySuccess(index, groqVetoKeys.length),
          logGroqKeyLimit: (index) => logGroqKeyLimit(index, groqVetoKeys.length),
          logGroqVeto,
          signal,
          groqKeyCooldownsHint: skipInMemoryCooldowns ? {} : mergedCooldowns,
          groqDbKeyIds: llmDb?.vetoRowIds,
          groqDbHardTimeoutMs: llmDb?.vetoHardTimeoutMs,
          preferredGroqKeyIndex: flowOpts?.preferredGroqVetoKeyIndex,
          usePreemptiveKeyRouting: usePreemptive,
          skipInMemoryCooldownHint: skipInMemoryCooldowns,
        })
        : { ai: groqResult, nextGroqKeyIndex: Number(quota?.current_groq_key_index ?? 0) };
      await logGroqKeySuccess(keyIndex, groqScanKeys.length);
      const scanRow = llmDb?.scanRowIds?.[keyIndex];
      if (scanRow) await touchLlmApiKeyUsed(scanRow);
      const quotaPatch: Record<string, unknown> = { current_groq_scan_key_index: keyIndex };
      if (!usePreemptive) quotaPatch.current_groq_key_index = reviewed.nextGroqKeyIndex;
      await patchAiQuotaState(quotaPatch);
      await saveAiCache(symbol, reviewed.ai);
      return {
        ai: withAiTrace(reviewed.ai, {
          provider: "groq",
          providerPath: `groq_key_${keyIndex + 1}_success`,
          cacheStatus: "miss",
        }),
        groqQuotaExhausted: false,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const scanRow = llmDb?.scanRowIds?.[keyIndex];
      if (scanRow && (isLlmHttpError(error) || isSoftQuotaOrRateLimit(msg) || isAbortOrTimeoutError(error))) {
        await recordLlmApiKeyHttpFailure(scanRow, error, {
          provider: "groq",
          keyIndex,
          symbol,
        });
      }
      if (isSoftQuotaOrRateLimit(msg)) groqQuotaExhausted = true;
      const backoffMs = resolveGroqKeyFailureCooldownMs(msg);
      if (backoffMs != null) {
        await logGroqKeyLimit(keyIndex, groqScanKeys.length);
        mergedCooldowns = {
          ...mergedCooldowns,
          [key]: Date.now() + backoffMs,
        };
        await patchAiQuotaState({
          groq_key_cooldowns: mergedCooldowns,
          current_groq_scan_key_index: keyIndex,
        });
        console.warn(
          `[AI DEBUG] Groq key #${keyIndex + 1} moved to cooldown (${msg.slice(0, 120)})`,
        );
        if (isSoftQuotaOrRateLimit(msg)) {
          console.warn(
            `[AI DEBUG] Groq scan quota circuit for ${symbol} — stop key rotation this invocation`,
          );
          break;
        }
        continue;
      }
      if (isAbortOrTimeoutError(error)) {
        console.warn(
          `[AI DEBUG] Groq timeout/abort key #${keyIndex + 1} for ${symbol} — trying next key`,
        );
        continue;
      }
      console.error("Groq Failure:", msg);
      console.log(AI_UNAVAILABLE_LOG);
      break;
    }
  }
  const staleCached = await getRecentAiCache(symbol, AI_STALE_CACHE_FALLBACK_MS);
  if (staleCached) {
    const ageSeconds = Math.max(0, Math.round(staleCached.ageMs / 1000));
    await logAiCacheHit(symbol, staleCached.ageMs);
    const analysis = applyStaleSignalBuyVeto(snapshot, staleCached.analysis);
    return {
      ai: withAiTrace(analysis, {
        provider: "cache",
        providerPath: `cache_stale_fallback_${ageSeconds}s`,
        cacheStatus: "bypassed",
        cacheAgeMs: staleCached.ageMs,
      }),
      groqQuotaExhausted,
    };
  }
  return { ai: null, groqQuotaExhausted };
}

function getAvailableKeyEntries(
  keys: string[],
  store: Record<string, number>,
): Array<{ index: number; key: string }> {
  const now = Date.now();
  const available: Array<{ index: number; key: string }> = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const cooldownUntil = Number(store[key] ?? 0);
    if (cooldownUntil <= now) {
      available.push({ index, key });
    }
  }
  return available;
}

export function buildPayload(
  snapshot: IndicatorSnapshot,
  symbol: string,
  botSettingsRow: Record<string, unknown> | null,
  options?: { omitAiScoringRubric?: boolean },
) {
  const lim = readAiLlmBarLimits();
  const m1Tape = tailCandles(pickOneMinuteTape(snapshot), lim.m1);
  const candles4hSrc = Array.isArray(snapshot.candles4h) ? snapshot.candles4h : [];
  const trend_htf = snapshot.trend_htf ?? {
    trend_1h: "flat" as const,
    trend_4h: "flat" as const,
    mtf_aligned: true,
    trend_15m: "flat" as const,
    mtf_ltf_aligned: true,
    mtf_effective_ok: true,
  };
  const base = {
    sandbox_mode: Boolean(
      botSettingsRow && (
        botSettingsRow.is_ghost_execution === true ||
        botSettingsRow.is_live_trading_enabled === false
      ),
    ),
    symbol,
    latestPrice: snapshot.latestPrice,
    /** 1m tape as [t,o,h,l,c,v] — merged longest available 1m tail, capped by `GROQ_AI_BARS_1M` (default 12). */
    candles1m: candlesToLlmTuples(m1Tape),
    candles15m: candlesToLlmTuples(tailCandles(snapshot.candles15m, lim.m15tf)),
    candles1h: candlesToLlmTuples(tailCandles(snapshot.candles1h, lim.h1)),
    candles4h: candlesToLlmTuples(tailCandles(candles4hSrc, lim.h4)),
    trend_htf,
    portfolio_basket_hint: resolvePortfolioBasketHint(symbol, botSettingsRow),
    marketRegime: snapshot.marketRegime,
    adx14: snapshot.adx14,
    atr14: snapshot.atr14,
    rsi: snapshot.rsi,
    rsi15m: snapshot.rsi15m,
    macd: snapshot.macd,
    ema200: snapshot.ema200,
    ema50: snapshot.ema50,
    market_context: { imbalance_ratio: snapshot.imbalance_ratio },
    symbol_strategy_hint: buildSymbolStrategyHint(symbol),
  };
  const includeRubric =
    !options?.omitAiScoringRubric && readAiLlmIncludeScoringRubric();
  if (!includeRubric) return base;
  return {
    ...base,
    /** Guides the four 0–100 sub-scores returned in JSON (weighted server-side). Omit unless `AI_LLM_INCLUDE_SCORING_RUBRIC=1`. */
    ai_scoring_rubric: {
      trend_score:
        "0–100: Multi-timeframe — align candles4h + candles1h + trend_htf with 1m tape (candles1m tuples). Penalize when trend_htf.mtf_aligned is false. Never imply strong BUY below ema200.",
      momentum_score: "0–100: RSI + MACD posture vs recent swings (payload rsi, rsi15m, macd).",
      volume_score:
        "0–100: breakout / surge conviction vs baseline chop (use candles + marketRegime).",
      order_book_score:
        "0–100: bid vs ask pressure using market_context.imbalance_ratio and microstructure.",
      execution_vs_trend_note:
        "Buy-flow server also fetches live 5m + 1h OHLCV: if last 1h close < EMA200 on 1h closes, weighted confidence is hard-capped at 55% before execution gates.",
      regime_scoring_note:
        "If marketRegime is RANGING (ADX<20 + tight Bollinger width on 1h), server uses mean-reversion score weights and blocks buys without dip/RSI/lower-BB context. TRENDING (ADX>25) uses standard trend weights.",
      sentiment_server_note:
        "After your JSON, the server runs a sentiment vibe (Fear & Greed 24h from Alternative.me + optional CryptoPanic headlines). If action is BUY and the market is in Extreme Fear or a hack-style headline hits, all four sub-scores are multiplied by 0.7 before the weighted confidence is recomputed.",
    },
  };
}

function withAiTrace(ai: AiAnalysis, trace: { provider: "cache" | "gemini" | "groq" | "openai" | "fallback"; providerPath: string; cacheStatus: "hit" | "miss" | "bypassed"; cacheAgeMs?: number }): AiAnalysis {
  return { ...ai, ai_provider: trace.provider, ai_provider_path: trace.providerPath, ai_cache_status: trace.cacheStatus, ai_cache_age_ms: trace.cacheAgeMs } as AiAnalysis;
}
function buildLimitFallback(): AiAnalysis {
  const base = {
    ai_confidence: 0,
    trend: "neutral" as const,
    trend_alignment: false,
    action: "HOLD" as const,
    trend_score: 0,
    momentum_score: 0,
    volume_score: 0,
    order_book_score: 0,
    signal: SAFETY_LIMIT_FALLBACK.signal,
    reason: SAFETY_LIMIT_FALLBACK.reason,
  } as AiAnalysis;
  base.ai_confidence = computeWeightedConfidence(base);
  return base;
}
function buildNeutralFallback(): AiAnalysis {
  const base: AiAnalysis = {
    ai_confidence: 0,
    trend: "neutral",
    trend_alignment: false,
    action: "HOLD",
    trend_score: 0,
    momentum_score: 0,
    volume_score: 0,
    order_book_score: 0,
  };
  base.ai_confidence = computeWeightedConfidence(base);
  return base;
}
