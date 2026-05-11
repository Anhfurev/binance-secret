// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVICE_ROLE_KEY, SUPABASE_URL } from "./constants.ts";
import type { AiAnalysis } from "./types.ts";
import { toNumber } from "./utils.ts";
import { computeWeightedConfidence } from "./ai-scoring.ts";
import {
  shouldPersistAiCacheHitLog,
  shouldPersistAiKeySuccessLog,
} from "./log-policy.ts";

export function getAiCacheClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function clamp01to100(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export async function getRecentAiCache(
  symbol: string,
  cacheWindowMs: number,
): Promise<{ analysis: AiAnalysis; ageMs: number } | null> {
  const supabase = getAiCacheClient();
  if (!supabase) return null;
  const minCreatedAt = new Date(Date.now() - cacheWindowMs).toISOString();
  const result = await supabase
    .from("ai_cache")
    .select("confidence, trend, action, trend_alignment, trend_score, momentum_score, volume_score, order_book_score, sentiment_haircut_applied, sentiment_penalty_factor, created_at")
    .eq("symbol", symbol)
    .gte("created_at", minCreatedAt)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) {
    console.warn(`[binance-bot] ai_cache read failed: ${result.error.message}`);
    return null;
  }
  const row = result.data as any;
  if (!row) return null;
  const confidence = clamp01to100(toNumber(row.confidence, 0));
  const trendRaw = String(row.trend ?? "neutral").toLowerCase();
  const trend =
    trendRaw === "bullish" || trendRaw === "bearish" ? trendRaw : "neutral";
  const actionRaw = String(row.action ?? "HOLD").toUpperCase();
  const action = actionRaw === "BUY" || actionRaw === "SELL"
    ? actionRaw
    : "HOLD";
  const trendAlignment = Boolean(row.trend_alignment);
  const createdAtMs = Date.parse(String(row.created_at ?? ""));
  const ageMs = Number.isFinite(createdAtMs)
    ? Math.max(0, Date.now() - createdAtMs)
    : cacheWindowMs;
  const trendScoreRaw = Number(row.trend_score);
  const momentumScoreRaw = Number(row.momentum_score);
  const volumeScoreRaw = Number(row.volume_score);
  const orderBookScoreRaw = Number(row.order_book_score);
  const hasScoreBreakdown = Number.isFinite(trendScoreRaw) &&
    Number.isFinite(momentumScoreRaw) &&
    Number.isFinite(volumeScoreRaw) &&
    Number.isFinite(orderBookScoreRaw);
  const trendScore = hasScoreBreakdown ? clamp01to100(trendScoreRaw) : confidence;
  const momentumScore = hasScoreBreakdown ? clamp01to100(momentumScoreRaw) : confidence;
  const volumeScore = hasScoreBreakdown ? clamp01to100(volumeScoreRaw) : confidence;
  const orderBookScore = hasScoreBreakdown ? clamp01to100(orderBookScoreRaw) : confidence;
  const base: AiAnalysis = {
    ai_confidence: 0,
    trend,
    trend_alignment: trendAlignment,
    action,
    trend_score: trendScore,
    momentum_score: momentumScore,
    volume_score: volumeScore,
    order_book_score: orderBookScore,
    pro_tip: "",
  };
  base.ai_confidence = computeWeightedConfidence(base);
  return {
    analysis: base,
    ageMs,
  };
}

export async function saveAiCache(symbol: string, ai: AiAnalysis) {
  const supabase = getAiCacheClient();
  if (!supabase) return;
  const penaltyApplied = Boolean(ai.sentiment_vibe?.penalty_applied);
  const penaltyFactorRaw = Number(ai.sentiment_vibe?.penalty_factor);
  const penaltyFactor = Number.isFinite(penaltyFactorRaw) && penaltyFactorRaw > 0 && penaltyFactorRaw < 1
    ? penaltyFactorRaw
    : null;
  const toRawScore = (score: unknown) => {
    const n = toNumber(score, 0);
    if (penaltyApplied && penaltyFactor) {
      return Math.max(0, Math.min(100, n / penaltyFactor));
    }
    return Math.max(0, Math.min(100, n));
  };
  const result = await supabase.from("ai_cache").insert([
    {
      symbol,
      confidence: ai.ai_confidence,
      trend: ai.trend,
      action: ai.action,
      trend_alignment: ai.trend_alignment,
      trend_score: toRawScore(ai.trend_score),
      momentum_score: toRawScore(ai.momentum_score),
      volume_score: toRawScore(ai.volume_score),
      order_book_score: toRawScore(ai.order_book_score),
      sentiment_haircut_applied: penaltyApplied,
      sentiment_penalty_factor: penaltyFactor,
      created_at: new Date().toISOString(),
    },
  ]);
  if (result.error) {
    console.warn(`[binance-bot] ai_cache write failed: ${result.error.message}`);
  }
}

export type AiQuotaState = {
  scope: string;
  consecutive_gemini_failures: number;
  gemini_cooldown_until: string | null;
  current_gemini_key_index: number;
  current_groq_key_index: number;
  gemini_key_cooldowns: Record<string, number>;
  groq_key_cooldowns: Record<string, number>;
  updated_at?: string | null;
  last_failure_at?: string | null;
};

const DEFAULT_AI_QUOTA_SCOPE = "global";
const AI_QUOTA_FAILURE_RESET_MS = 60 * 60 * 1000;

function fromNewSchemaRow(data: Record<string, unknown>, scope: string): AiQuotaState {
  return {
    scope: String(data.id ?? scope),
    consecutive_gemini_failures: Number(data.consecutive_failures ?? 0),
    gemini_cooldown_until: typeof data.cooldown_until === "string" ? data.cooldown_until : null,
    current_gemini_key_index: Number(data.current_key_index ?? 0),
    current_groq_key_index: 0,
    gemini_key_cooldowns: {},
    groq_key_cooldowns: {},
    updated_at: typeof data.updated_at === "string" ? data.updated_at : null,
    last_failure_at: typeof data.last_failure_at === "string" ? data.last_failure_at : null,
  };
}

function fromLegacyRow(data: Record<string, unknown>, scope: string): AiQuotaState {
  return {
    scope: String(data.scope ?? scope),
    consecutive_gemini_failures: Number(data.consecutive_gemini_failures ?? 0),
    gemini_cooldown_until: typeof data.gemini_cooldown_until === "string" ? data.gemini_cooldown_until : null,
    current_gemini_key_index: Number(data.current_gemini_key_index ?? 0),
    current_groq_key_index: Number(data.current_groq_key_index ?? 0),
    gemini_key_cooldowns: (data.gemini_key_cooldowns && typeof data.gemini_key_cooldowns === "object")
      ? (data.gemini_key_cooldowns as Record<string, number>)
      : {},
    groq_key_cooldowns: (data.groq_key_cooldowns && typeof data.groq_key_cooldowns === "object")
      ? (data.groq_key_cooldowns as Record<string, number>)
      : {},
    updated_at: typeof data.updated_at === "string" ? data.updated_at : null,
    last_failure_at: typeof data.last_failure_at === "string" ? data.last_failure_at : null,
  };
}

export async function getAiQuotaState(scope = DEFAULT_AI_QUOTA_SCOPE): Promise<AiQuotaState | null> {
  const supabase = getAiCacheClient();
  if (!supabase) return null;

  // Read-only first: do not bump `updated_at` on every read or it would
  // overwrite the failure-time anchor used by the 1h auto-reset window.
  const preferredRead = await supabase
    .from("ai_quota_state")
    .select("*")
    .eq("id", scope)
    .maybeSingle();

  let state: AiQuotaState | null = null;
  if (!preferredRead.error && preferredRead.data) {
    state = fromNewSchemaRow(preferredRead.data as Record<string, unknown>, scope);
  } else {
    const legacyRead = await supabase
      .from("ai_quota_state")
      .select("*")
      .eq("scope", scope)
      .maybeSingle();
    if (legacyRead.error) {
      console.warn(
        `[binance-bot] ai_quota_state read failed: ${preferredRead.error?.message ?? legacyRead.error?.message ?? "unknown_error"}`,
      );
      return null;
    }
    if (legacyRead.data) {
      state = fromLegacyRow(legacyRead.data as Record<string, unknown>, scope);
    }
  }

  if (!state) {
    // First-time row: initialize with a single upsert, do not auto-reset on init.
    const init = await supabase
      .from("ai_quota_state")
      .upsert(
        { id: scope, consecutive_failures: 0, current_key_index: 0, updated_at: new Date().toISOString() },
        { onConflict: "id" },
      )
      .select("*")
      .maybeSingle();
    if (init.error || !init.data) {
      const legacyInit = await supabase
        .from("ai_quota_state")
        .upsert(
          { scope, consecutive_gemini_failures: 0, updated_at: new Date().toISOString() },
          { onConflict: "scope" },
        )
        .select("*")
        .maybeSingle();
      if (legacyInit.error || !legacyInit.data) return null;
      return fromLegacyRow(legacyInit.data as Record<string, unknown>, scope);
    }
    return fromNewSchemaRow(init.data as Record<string, unknown>, scope);
  }

  const referenceFailureAt = state.last_failure_at ?? state.updated_at;
  const failureAtMs = referenceFailureAt ? Date.parse(referenceFailureAt) : NaN;
  if (
    state.consecutive_gemini_failures > 0 &&
    Number.isFinite(failureAtMs) &&
    Date.now() - failureAtMs > AI_QUOTA_FAILURE_RESET_MS
  ) {
    await patchAiQuotaState({
      consecutive_gemini_failures: 0,
      last_failure_at: null,
    }, scope);
    state.consecutive_gemini_failures = 0;
    state.last_failure_at = null;
  }
  return state;
}

function isMissingColumnError(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("could not find the") &&
    m.includes("column")
  ) || m.includes("does not exist") || m.includes("schema cache");
}

export async function patchAiQuotaState(
  patch: Partial<AiQuotaState>,
  scope = DEFAULT_AI_QUOTA_SCOPE,
) {
  const supabase = getAiCacheClient();
  if (!supabase) return;
  const nowIso = new Date().toISOString();

  const buildNewPayload = (includeLastFailureAt: boolean) => {
    const payload: Record<string, unknown> = {
      id: scope,
      updated_at: nowIso,
    };
    if (patch.consecutive_gemini_failures != null) payload.consecutive_failures = patch.consecutive_gemini_failures;
    if (patch.gemini_cooldown_until !== undefined) payload.cooldown_until = patch.gemini_cooldown_until;
    if (patch.current_gemini_key_index != null) payload.current_key_index = patch.current_gemini_key_index;
    if (includeLastFailureAt && patch.last_failure_at !== undefined) {
      payload.last_failure_at = patch.last_failure_at;
    }
    return payload;
  };

  let preferred = await supabase
    .from("ai_quota_state")
    .upsert(buildNewPayload(true), { onConflict: "id" });

  // Retry without `last_failure_at` if the column does not exist yet.
  if (preferred.error && isMissingColumnError(preferred.error.message)) {
    preferred = await supabase
      .from("ai_quota_state")
      .upsert(buildNewPayload(false), { onConflict: "id" });
  }

  if (!preferred.error) return;

  const legacyPayload: Record<string, unknown> = {
    scope,
    updated_at: nowIso,
  };
  if (patch.consecutive_gemini_failures != null) legacyPayload.consecutive_gemini_failures = patch.consecutive_gemini_failures;
  if (patch.gemini_cooldown_until !== undefined) legacyPayload.gemini_cooldown_until = patch.gemini_cooldown_until;
  if (patch.current_gemini_key_index != null) legacyPayload.current_gemini_key_index = patch.current_gemini_key_index;
  if (patch.current_groq_key_index != null) legacyPayload.current_groq_key_index = patch.current_groq_key_index;
  if (patch.gemini_key_cooldowns != null) legacyPayload.gemini_key_cooldowns = patch.gemini_key_cooldowns;
  if (patch.groq_key_cooldowns != null) legacyPayload.groq_key_cooldowns = patch.groq_key_cooldowns;
  if (patch.last_failure_at !== undefined) legacyPayload.last_failure_at = patch.last_failure_at;

  const legacy = await supabase
    .from("ai_quota_state")
    .upsert(legacyPayload, { onConflict: "scope" });
  if (legacy.error) {
    console.warn(
      `[binance-bot] ai_quota_state patch failed: ${preferred.error.message}; legacy_fallback=${legacy.error.message}`,
    );
  }
}

export async function logAiCacheHit(symbol: string, ageMs: number) {
  const supabase = getAiCacheClient();
  if (!supabase || !shouldPersistAiCacheHitLog()) return;
  const ageSeconds = Math.max(0, Math.round(ageMs / 1000));
  const result = await supabase.from("logs").insert([
    {
      user_id: null,
      symbol,
      level: "info",
      source: "ai",
      message: `[Cache Hit - ${ageSeconds}s old] Reusing full verdict for ${symbol}`,
      meta: { event: "ai_cache_hit", symbol, cache_age_ms: ageMs },
      created_at: new Date().toISOString(),
    },
  ]);
  if (result.error) {
    console.warn(`[binance-bot] failed to log cache hit: ${result.error.message}`);
  }
}

/**
 * Per-process throttle for AI key rotation logs. We were inserting ~16k rows /
 * day per provider into `public.logs`, dwarfing useful telemetry. Now we keep
 * a per-key counter in memory and flush at most one row per provider+key per
 * window with the aggregated count.
 */
const KEY_ROTATION_LOG_WINDOW_MS = 60_000;
type KeyRotationStats = {
  /** Wall-clock ms of the most recent flushed insert. */
  lastEmitMs: number;
  /** Hits suppressed since the last flush — included in the next flush's meta. */
  suppressedSinceEmit: number;
  totalKeys: number;
};
const keyRotationStats = new Map<string, KeyRotationStats>();

/**
 * Emit at most one `*_key_rotated` log per provider+keyIndex per
 * `KEY_ROTATION_LOG_WINDOW_MS`. Hits inside the active window are counted and
 * surfaced as `suppressed_in_prev_window` on the next emission so we don't
 * lose the rotation rate signal.
 */
async function emitThrottledKeyRotation(params: {
  provider: "gemini" | "groq";
  index: number;
  totalKeys: number;
  message: string;
  event: string;
}) {
  const { provider, index, totalKeys, message, event } = params;
  const supabase = getAiCacheClient();
  if (!supabase) return;
  const now = Date.now();
  const key = `${provider}:${index}`;
  const prev = keyRotationStats.get(key);
  if (prev && now - prev.lastEmitMs < KEY_ROTATION_LOG_WINDOW_MS) {
    prev.suppressedSinceEmit += 1;
    prev.totalKeys = totalKeys;
    return;
  }
  const suppressedFromLastWindow = prev?.suppressedSinceEmit ?? 0;
  keyRotationStats.set(key, {
    lastEmitMs: now,
    suppressedSinceEmit: 0,
    totalKeys,
  });
  const result = await supabase.from("logs").insert([
    {
      user_id: null,
      symbol: null,
      level: "warn",
      source: "ai",
      message,
      meta: {
        event,
        key_index: index,
        total_keys: totalKeys,
        suppressed_in_prev_window: suppressedFromLastWindow,
        window_ms: KEY_ROTATION_LOG_WINDOW_MS,
      },
      created_at: new Date().toISOString(),
    },
  ]);
  if (result.error) {
    console.warn(`[binance-bot] failed to log ${provider} key rotation: ${result.error.message}`);
  }
}

export async function logGeminiKeyLimit(index: number, totalKeys: number) {
  await emitThrottledKeyRotation({
    provider: "gemini",
    index,
    totalKeys,
    message: `Key [${index}] hit limit, rotating to next key`,
    event: "gemini_key_rotated",
  });
}

export async function logGeminiKeySuccess(index: number, totalKeys: number) {
  const supabase = getAiCacheClient();
  if (!supabase || !shouldPersistAiKeySuccessLog()) return;
  const result = await supabase.from("logs").insert([
    {
      user_id: null,
      symbol: null,
      level: "info",
      source: "ai",
      message: `[Key #${index + 1}] Success`,
      meta: { event: "gemini_key_success", key_index: index, total_keys: totalKeys },
      created_at: new Date().toISOString(),
    },
  ]);
  if (result.error) {
    console.warn(`[binance-bot] failed to log key success: ${result.error.message}`);
  }
}

export async function logGroqKeyLimit(index: number, totalKeys: number) {
  await emitThrottledKeyRotation({
    provider: "groq",
    index,
    totalKeys,
    message: `[Groq Key #${index + 1}] LIMIT HIT - Rotating...`,
    event: "groq_key_rotated",
  });
}

export async function logGroqKeySuccess(index: number, totalKeys: number) {
  const supabase = getAiCacheClient();
  if (!supabase || !shouldPersistAiKeySuccessLog()) return;
  const result = await supabase.from("logs").insert([
    {
      user_id: null,
      symbol: null,
      level: "info",
      source: "ai",
      message: `[Groq Key #${index + 1}] Success`,
      meta: { event: "groq_key_success", key_index: index, total_keys: totalKeys },
      created_at: new Date().toISOString(),
    },
  ]);
  if (result.error) {
    console.warn(`[binance-bot] failed to log groq key success: ${result.error.message}`);
  }
}

export async function logGroqVeto(symbol: string, reason: string) {
  const supabase = getAiCacheClient();
  if (!supabase) return;
  const result = await supabase.from("logs").insert([
    {
      user_id: null,
      symbol,
      level: "warn",
      source: "ai",
      message: "groq_buy_veto",
      meta: { event: "groq_buy_veto", reason },
      created_at: new Date().toISOString(),
    },
  ]);
  if (result.error) {
    console.warn(`[binance-bot] failed to log groq veto: ${result.error.message}`);
  }
}
