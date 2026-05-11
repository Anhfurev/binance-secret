// @ts-nocheck
import type { AiAnalysis, IndicatorSnapshot } from "./types.ts";
import { getGeminiKeysFromEnv, getGroqKeysFromEnv } from "./ai-keys.ts";
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
  collectSentimentVibe,
  isExtremeFearFng,
} from "./sentiment-check.ts";
import {
  computeWeightedConfidence,
  computeWeightedConfidenceForRegime,
  type ScoreWeightsRecord,
} from "./ai-scoring.ts";
import { resolvePortfolioBasketHint } from "./portfolio-basket.ts";

export const GEMINI_QUOTA_COOLDOWN_MS = 10 * 60 * 1000;

function isAbortOrTimeoutError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  const m = String((error as Error)?.message ?? error).toLowerCase();
  return m.includes("abort") || m.includes("timeout");
}

function readAiCacheWindowMs(): number {
  const raw = String(Deno.env.get("AI_CACHE_WINDOW_MS") ?? "").trim();
  const n = raw.length ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 90 * 1000;
  return Math.min(5 * 60 * 1000, Math.max(30_000, Math.floor(n)));
}
const AI_STALE_CACHE_FALLBACK_MS = 10 * 60 * 1000;
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
  },
): Promise<AiAnalysis> {
  const symbol = String(snapshot.symbol || "BTCUSDT").toUpperCase();
  const geminiKeys = getGeminiKeysFromEnv();
  const groqKeys = getGroqKeysFromEnv();
  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const payload = buildPayload(
    snapshot,
    symbol,
    options?.botSettingsRow ?? null,
  );
  const shouldBypassCache = Boolean(options?.skipCache);
  const sw = options?.scoreWeights ?? null;

  if (!shouldBypassCache) {
    const cached = await getRecentAiCache(symbol, readAiCacheWindowMs());
    if (cached) {
      const ageSeconds = Math.max(0, Math.round(cached.ageMs / 1000));
      await logAiCacheHit(symbol, cached.ageMs);
      return await applySentimentVibeCheck(
        withAiTrace(cached.analysis, {
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
  const geminiResult = await tryGeminiFlow(
    geminiKeys,
    groqKeys,
    snapshot,
    payload,
    symbol,
    options?.signal,
  );
  if (geminiResult) {
    return await applySentimentVibeCheck(
      geminiResult,
      snapshot,
      sw,
      await sentimentPrefetch,
    );
  }
  const groqResult = await tryGroqFlow(groqKeys, payload, symbol, options?.signal);
  if (groqResult) return await applySentimentVibeCheck(groqResult, snapshot, sw);

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
  const cached = await getRecentAiCache(symbol.toUpperCase(), readAiCacheWindowMs());
  if (!cached) return null;
  const ageSeconds = Math.max(0, Math.round(cached.ageMs / 1000));
  return withAiTrace(cached.analysis, {
    provider: "cache",
    providerPath: `cache_hit_${ageSeconds}s`,
    cacheStatus: "hit",
    cacheAgeMs: cached.ageMs,
  });
}

async function tryGeminiFlow(
  geminiKeys: string[],
  groqKeys: string[],
  snapshot: IndicatorSnapshot,
  payload: unknown,
  symbol: string,
  signal?: AbortSignal,
) {
  const quota = await getAiQuotaState();
  const cooldownUntilMs = quota?.gemini_cooldown_until ? Date.parse(quota.gemini_cooldown_until) : 0;
  if (geminiKeys.length === 0 || (Number.isFinite(cooldownUntilMs) && Date.now() < cooldownUntilMs)) return null;
  const available = getAvailableKeyEntries(geminiKeys, quota?.gemini_key_cooldowns ?? {});
  if (available.length === 0) {
    await activateGeminiQuotaCooldown();
    console.warn(`[AI DEBUG] All Gemini keys cooling down for ${symbol}; waiting refresh window`);
    return null;
  }
  const baseIndex = Number.isFinite(Number(quota?.current_gemini_key_index))
    ? Number(quota?.current_gemini_key_index)
    : 0;
  const startIndex = (baseIndex + 1) % available.length;
  for (let attempt = 0; attempt < available.length; attempt += 1) {
    const selected = available[(startIndex + attempt) % available.length];
    const keyIndex = selected.index;
    const key = selected.key;
    try {
      const fresh = await geminiAnalyze(key, payload, signal);
      const reviewed = fresh.action === "BUY"
        ? await applyGroqBuyVeto({
          groqKeys,
          snapshot,
          ai: fresh,
          symbol,
          currentGroqKeyIndex: Number(quota?.current_groq_key_index ?? 0),
          logGroqKeySuccess: (index) => logGroqKeySuccess(index, groqKeys.length),
          logGroqKeyLimit: (index) => logGroqKeyLimit(index, groqKeys.length),
          logGroqVeto,
          signal,
        })
        : { ai: fresh, nextGroqKeyIndex: Number(quota?.current_groq_key_index ?? 0) };
      await patchAiQuotaState({
        current_gemini_key_index: keyIndex,
        current_groq_key_index: reviewed.nextGroqKeyIndex,
      });
      await logGeminiKeySuccess(keyIndex, geminiKeys.length);
      await saveAiCache(symbol, reviewed.ai);
      return withAiTrace(reviewed.ai, {
        provider: "gemini",
        providerPath: `gemini_key_${keyIndex + 1}_success`,
        cacheStatus: "miss",
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isRateLimitErrorMessage(msg)) {
        await logGeminiKeyLimit(keyIndex, geminiKeys.length);
        const nextCooldowns = {
          ...(quota?.gemini_key_cooldowns ?? {}),
          [key]: Date.now() + GEMINI_QUOTA_COOLDOWN_MS,
        };
        await patchAiQuotaState({
          gemini_key_cooldowns: nextCooldowns,
          current_gemini_key_index: keyIndex,
        });
        console.warn(`[AI DEBUG] Gemini key #${keyIndex + 1} moved to cooldown (rate-limited)`);
        const staleCached = await getRecentAiCache(symbol, AI_STALE_CACHE_FALLBACK_MS);
        if (staleCached) {
          const ageSeconds = Math.max(0, Math.round(staleCached.ageMs / 1000));
          await logAiCacheHit(symbol, staleCached.ageMs);
          return withAiTrace(staleCached.analysis, {
            provider: "cache",
            providerPath: `cache_stale_fallback_${ageSeconds}s`,
            cacheStatus: "bypassed",
            cacheAgeMs: staleCached.ageMs,
          });
        }
        return null;
      }
      if (isAbortOrTimeoutError(error)) {
        console.warn(
          `[AI DEBUG] Gemini timeout/abort key #${keyIndex + 1} for ${symbol} — trying next key`,
        );
        continue;
      }
      console.error("Gemini Failure:", msg);
      break;
    }
  }
  return null;
}

async function tryGroqFlow(groqKeys: string[], payload: unknown, symbol: string, signal?: AbortSignal) {
  const quota = await getAiQuotaState();
  if (groqKeys.length === 0) return null;
  const available = getAvailableKeyEntries(groqKeys, quota?.groq_key_cooldowns ?? {});
  if (available.length === 0) {
    console.warn(`[AI DEBUG] All Groq keys cooling down for ${symbol}; waiting refresh window`);
    return null;
  }
  const baseIndex = Number.isFinite(Number(quota?.current_groq_key_index))
    ? Number(quota?.current_groq_key_index)
    : 0;
  const startIndex = (baseIndex + 1) % available.length;
  for (let attempt = 0; attempt < available.length; attempt += 1) {
    const selected = available[(startIndex + attempt) % available.length];
    const keyIndex = selected.index;
    const key = selected.key;
    try {
      const groqResult = await groqAnalyze(key, payload, signal);
      await logGroqKeySuccess(keyIndex, groqKeys.length);
      await patchAiQuotaState({ current_groq_key_index: keyIndex });
      await saveAiCache(symbol, groqResult);
      return withAiTrace(groqResult, {
        provider: "groq",
        providerPath: `groq_key_${keyIndex + 1}_success`,
        cacheStatus: "miss",
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("QUOTA_EXHAUSTED")) {
        await logGroqKeyLimit(keyIndex, groqKeys.length);
        const nextCooldowns = {
          ...(quota?.groq_key_cooldowns ?? {}),
          [key]: Date.now() + GEMINI_QUOTA_COOLDOWN_MS,
        };
        await patchAiQuotaState({
          groq_key_cooldowns: nextCooldowns,
          current_groq_key_index: keyIndex,
        });
        console.warn(`[AI DEBUG] Groq key #${keyIndex + 1} moved to ended-keys cooldown`);
        continue;
      }
      console.error("Groq Failure:", msg);
      console.log(AI_UNAVAILABLE_LOG);
      return buildLimitFallback();
    }
  }
  return buildLimitFallback();
}

function isRateLimitErrorMessage(message: string) {
  const msg = String(message ?? "").toUpperCase();
  return msg.includes("QUOTA_EXHAUSTED") ||
    msg.includes("RATE LIMIT") ||
    msg.includes("RATE_LIMIT") ||
    msg.includes("STATUS 429") ||
    msg.includes(" 429");
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

function buildPayload(
  snapshot: IndicatorSnapshot,
  symbol: string,
  botSettingsRow: Record<string, unknown> | null,
) {
  const candles4h = Array.isArray(snapshot.candles4h)
    ? snapshot.candles4h.slice(-10)
    : [];
  const trend_htf = snapshot.trend_htf ?? {
    trend_1h: "flat" as const,
    trend_4h: "flat" as const,
    mtf_aligned: true,
    trend_15m: "flat" as const,
    mtf_ltf_aligned: true,
    mtf_effective_ok: true,
  };
  return {
    sandbox_mode: Boolean(
      botSettingsRow && (
        botSettingsRow.is_ghost_execution === true ||
        botSettingsRow.is_live_trading_enabled === false
      ),
    ),
    symbol,
    latestPrice: snapshot.latestPrice,
    candles1m: snapshot.candles5,
    candles15mWindow: snapshot.candles15,
    candles15m: snapshot.candles15m,
    candles1h: snapshot.candles1h.slice(-10),
    candles4h,
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
    /** Guides the four 0–100 sub-scores returned in JSON (weighted server-side). */
    ai_scoring_rubric: {
      trend_score:
        "0–100: Multi-timeframe — align candles4h + candles1h + trend_htf with 5m tape (candles5 / candles1m). Penalize when trend_htf.mtf_aligned is false. Never imply strong BUY below ema200.",
      momentum_score: "0–100: RSI + MACD posture vs recent swings (payload rsi, rsi15m, macd).",
      volume_score:
        "0–100: breakout / surge conviction vs baseline chop (use candles + marketRegime).",
      order_book_score:
        "0–100: bid vs ask pressure using market_context.imbalance_ratio and microstructure.",
      execution_vs_trend_note:
        "Buy-flow server also fetches live 5m + 1h OHLCV: if last 1h close < EMA200 on 1h closes, weighted confidence is hard-capped at 40% before execution gates.",
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
