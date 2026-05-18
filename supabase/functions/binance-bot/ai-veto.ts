// @ts-nocheck
import type { AiAnalysis, IndicatorSnapshot } from "./types.ts";
import { GLOBAL_BOT_CONFIG } from "./config.ts";
import {
  envLlmTimeoutMs,
  fetchWithExponentialBackoff,
  mergeLlmAbortSignal,
  type LlmPerKeyTimeoutOpts,
} from "./ai-models.ts";
import { resolveGroqTrapModel } from "./ai-groq-models.ts";
import { enforceGroqRequestSpacing } from "./groq-request-spacing.ts";
import { safeJsonParseFromText } from "./utils.ts";
import {
  buildVetoTechnicalWindow,
  evaluateStaleSignalVeto,
  shouldFastTrackGroqBuyVeto,
} from "./ai-veto-helpers.ts";
import { withLlmConcurrency } from "./ai-llm-concurrency.ts";
import { emitGroqTelemetry } from "./ai-llm-telemetry.ts";
import { getAiQuotaState, patchAiQuotaState } from "./ai-db.ts";
import { readGroqSoftFailureCooldownMs } from "./groq-key-failure-cooldown.ts";
import { isSoftQuotaOrRateLimit } from "./llm-key-backoff.ts";
import { isLlmHttpError, LlmHttpError } from "./llm-http-error.ts";
import { touchLlmApiKeyUsed } from "./llm-api-keys-repo.ts";
import { buildPreemptiveRotationOrder } from "./llm-key-preemptive-route.ts";
import {
  countLanePoolKeysEligible,
  withLlmKeyCheckout,
} from "./llm-key-checkout.ts";
import { groqVetoPoolKeyId } from "./llm-key-pool.ts";
import { applyRotationCircuitAfterHttpFailure } from "./llm-rotation-circuit-breaker.ts";
import { groqIndexToLlmMeta } from "./llm-key-slot-gate.ts";
import {
  canStartRotationHttpAttempt,
  createSymbolRotationBudget,
} from "./llm-symbol-rotation-budget.ts";
import { isLlmRateLimitHttpFailure } from "./llm-key-failure-classify.ts";
import {
  buildGroqGatekeeperLeanPayload,
  GROQ_GATEKEEPER_LEAN_SYSTEM,
} from "./ai-groq-gatekeeper-lean.ts";
const GROQ_TRAP_REVIEW_SYSTEM = [
  "You are a ruthless, quantitative crypto trading AI.",
  "Evaluate this market data and return ONLY a strict JSON object. Do not include any conversational prose, markdown formatting, or explanations outside the JSON.",
  "Your JSON must match this exact schema:",
  '{ "action": "APPROVE" | "REJECT", "confidence": number (0-100), "reasoning": "A single sentence explaining the decision." }',
  'Default action to "APPROVE" unless there is clear, immediate technical danger.',
].join(" ");

export function buildSymbolStrategyHint(symbol: string) {
  if (
    GLOBAL_BOT_CONFIG.MEME_STRATEGY_SYMBOLS.includes(
      String(symbol).toUpperCase(),
    )
  ) {
    return {
      priority: "volume_spikes_and_social_sentiment",
      note: "For this meme-tier symbol, prefer volume acceleration and sentiment-driven momentum over classical RSI/MACD neutrality.",
    };
  }
  return {
    priority: "standard_technicals",
    note: "Use standard RSI/MACD/EMA and multi-timeframe confirmation.",
  };
}

export async function applyGroqBuyVeto(params: {
  groqKeys: string[];
  snapshot: IndicatorSnapshot;
  ai: AiAnalysis;
  symbol: string;
  currentGroqKeyIndex: number;
  logGroqKeySuccess: (index: number) => Promise<void>;
  logGroqKeyLimit: (index: number) => Promise<void>;
  logGroqVeto: (symbol: string, reason: string) => Promise<void>;
  signal?: AbortSignal;
  groqKeyCooldownsHint?: Record<string, number>;
  /** Parallel to `groqKeys` for `llm_api_keys` rows when `LLM_API_KEYS_DB=1`. */
  groqDbKeyIds?: (string | undefined)[];
  /** Parallel to `groqDbKeyIds` — row `error_count` at pool load. */
  groqDbKeyErrorCounts?: (number | undefined)[];
  groqDbKeyStatuses?: import("./llm-api-keys-types.ts").LlmApiKeyRow["status"][];
  groqDbKeyCooldownUntils?: (string | null | undefined)[];
  /** Caps Groq veto HTTP wait when DB keys are used. */
  groqDbHardTimeoutMs?: number;
  preferredGroqKeyIndex?: number;
  usePreemptiveKeyRouting?: boolean;
  skipInMemoryCooldownHint?: boolean;
  /** Tier 3 cascade: lean order-book + Gemini summary prompt (no full tape). */
  cascadeLean?: boolean;
  geminiStructuralSummary?: string;
}): Promise<{ ai: AiAnalysis; nextGroqKeyIndex: number }> {
  const {
    groqKeys,
    snapshot,
    ai,
    symbol,
    logGroqKeySuccess,
    logGroqKeyLimit,
    logGroqVeto,
    signal,
    groqKeyCooldownsHint,
    groqDbKeyIds,
    groqDbKeyErrorCounts,
    groqDbKeyStatuses,
    groqDbKeyCooldownUntils,
    groqDbHardTimeoutMs,
    preferredGroqKeyIndex,
    usePreemptiveKeyRouting,
    skipInMemoryCooldownHint,
    cascadeLean,
    geminiStructuralSummary,
  } = params;
  let nextGroqKeyIndex = params.currentGroqKeyIndex;
  const usePreemptive = Boolean(
    usePreemptiveKeyRouting &&
    preferredGroqKeyIndex != null &&
    groqKeys.length > 0,
  );
  if (groqKeys.length === 0 || ai.action !== "BUY") {
    return { ai, nextGroqKeyIndex };
  }
  console.log(
    `[AI DEBUG] groq_path_selected symbol=${symbol} ai_action=${ai.action} groq_keys=${groqKeys.length}`,
  );

  const stale = evaluateStaleSignalVeto(snapshot);
  if (stale?.reject) {
    await logGroqVeto(symbol, stale.reason);
    return {
      ai: {
        ...ai,
        action: "HOLD",
        trend_alignment: false,
        groq_verdict: "REJECT",
        groq_reason: stale.reason,
        raw_groq_veto_response: {
          action: "REJECT",
          reason: stale.reason,
          fast_path: true,
        },
      },
      nextGroqKeyIndex,
    };
  }

  if (!cascadeLean && shouldFastTrackGroqBuyVeto(ai)) {
    const conf = Number(ai.ai_confidence);
    console.log(
      `[AI DEBUG] groq_veto_fast_track symbol=${symbol} confidence=${conf} path=high_conviction_skip_llm`,
    );
    return {
      ai: {
        ...ai,
        groq_verdict: "SKIPPED",
        groq_reason: `high_conviction_fast_track:${conf}`,
        raw_groq_veto_response: {
          action: "SKIP",
          reason: "high_conviction_fast_track",
          fast_path: true,
          ai_confidence: conf,
        },
      },
      nextGroqKeyIndex,
    };
  }

  const mergedInit = skipInMemoryCooldownHint
    ? {}
    : groqKeyCooldownsHint === undefined
      ? ((await getAiQuotaState())?.groq_key_cooldowns ?? {})
      : { ...(groqKeyCooldownsHint ?? {}) };
  let mergedGroqCooldowns: Record<string, number> = { ...mergedInit };
  const rotationOrder = usePreemptive
    ? buildPreemptiveRotationOrder(preferredGroqKeyIndex!, groqKeys.length)
    : (() => {
        nextGroqKeyIndex = (nextGroqKeyIndex + 1) % groqKeys.length;
        const legacyStart = nextGroqKeyIndex;
        const order: number[] = [];
        for (let attempt = 0; attempt < groqKeys.length; attempt += 1) {
          order.push((legacyStart + attempt) % groqKeys.length);
        }
        return order;
      })();
  const rotBudget = createSymbolRotationBudget(symbol, "groq_veto");
  for (let attempt = 0; attempt < rotationOrder.length; attempt += 1) {
    const keyIndex = rotationOrder[attempt]!;
    const isAssignedPreemptiveKey =
      usePreemptive && keyIndex === preferredGroqKeyIndex;
    const key = (groqKeys[keyIndex] ?? "").trim();
    if (!key) {
      console.warn(
        `[AI DEBUG] groq_key_missing_or_empty symbol=${symbol} key_index=${keyIndex + 1} attempt=${attempt + 1}`,
      );
      continue;
    }
    if (
      Number(mergedGroqCooldowns[key] ?? 0) > Date.now() &&
      !isAssignedPreemptiveKey
    ) {
      console.log(
        `[AI DEBUG] groq_veto_skip_cooled_key symbol=${symbol} key_index=${keyIndex + 1}`,
      );
      continue;
    }
    if (!canStartRotationHttpAttempt(rotBudget)) {
      console.warn(
        `[CIRCUIT BREAKER] Groq veto ${symbol} — local rotation budget exhausted, exit veto`,
      );
      break;
    }
    const vetoMeta = groqIndexToLlmMeta(
      keyIndex,
      groqDbKeyIds,
      groqDbKeyErrorCounts,
      groqDbKeyStatuses,
      groqDbKeyCooldownUntils,
    );
    const vetoDbRow = vetoMeta.dbRowId;
    const vetoKeyId = groqVetoPoolKeyId(keyIndex);
    try {
      const review = await withLlmKeyCheckout(
        {
          provider: "groq",
          preferredKeyId: vetoKeyId,
          dbRowId: vetoDbRow,
          rowErrorCount: vetoMeta.errorCount,
          slotMeta: vetoMeta,
          providerLabel: `Groq veto key #${keyIndex + 1} symbol=${symbol}`,
        },
        async (handle) => {
          console.log(
            `[AI DEBUG] groq_path_selected symbol=${symbol} key_index=${keyIndex + 1} attempt=${attempt + 1}`,
          );
          const trapModel = resolveGroqTrapModel(Number(ai.ai_confidence));
          const defaultVetoMs = /70b/i.test(trapModel) ? 25_000 : 8000;
          const vetoSignal = mergeLlmAbortSignal(
            signal,
            envLlmTimeoutMs("GROQ_VETO_TIMEOUT_MS", defaultVetoMs),
          );
          return await withLlmConcurrency(() =>
            cascadeLean
              ? groqCascadeGatekeeperReview(
                handle.secret,
                buildGroqGatekeeperLeanPayload({
                  symbol,
                  snapshot,
                  structuralReasoning:
                    geminiStructuralSummary ??
                    (String(ai.structural_reasoning ?? ai.reason ?? "").trim() ||
                      `action=${ai.action}`),
                }),
                vetoSignal,
                groqDbHardTimeoutMs != null
                  ? { dbHardTimeoutMs: groqDbHardTimeoutMs }
                  : undefined,
              )
              : groqTrapReview(
                handle.secret,
                {
                  symbol,
                  rsi: snapshot.rsi,
                  latestPrice: snapshot.latestPrice,
                  market_context: { imbalance_ratio: snapshot.imbalance_ratio },
                  symbol_strategy_hint: buildSymbolStrategyHint(symbol),
                  veto_window: buildVetoTechnicalWindow(snapshot),
                },
                vetoSignal,
                Number(ai.ai_confidence),
                groqDbHardTimeoutMs != null
                  ? { dbHardTimeoutMs: groqDbHardTimeoutMs }
                  : undefined,
              ),
          );
        },
      );
      if (!review) continue;
      await logGroqKeySuccess(keyIndex);
      if (vetoDbRow) await touchLlmApiKeyUsed(vetoDbRow);
      if (review.action === "REJECT") {
        await logGroqVeto(symbol, review.reason);
        return {
          ai: {
            ...ai,
            action: "HOLD",
            trend_alignment: false,
            groq_verdict: "REJECT",
            groq_reason: review.reason,
            raw_groq_veto_response: review,
          },
          nextGroqKeyIndex,
        };
      }
      const approvedBuy = cascadeLean && review.buyAction === "BUY";
      const conf = Number.isFinite(review.confidenceScore)
        ? review.confidenceScore
        : review.confidence;
      return {
        ai: {
          ...ai,
          action: approvedBuy ? "BUY" : cascadeLean ? "HOLD" : ai.action,
          trend_alignment: approvedBuy ? ai.trend_alignment : false,
          groq_verdict: "APPROVE",
          groq_reason: review.reason,
          raw_groq_veto_response: review,
          ...(Number.isFinite(conf) ? { ai_confidence: conf } : {}),
        },
        nextGroqKeyIndex,
      };
    } catch (error) {
      const { action, outcome: releaseOutcome } = await applyRotationCircuitAfterHttpFailure({
        budget: rotBudget,
        keyId: vetoKeyId,
        dbRowId: vetoDbRow,
        rowErrorCount: vetoMeta.errorCount,
        error,
        context: { provider: "groq", keyIndex, symbol },
      });
      if (action === "stop_miss") {
        return { ai, nextGroqKeyIndex };
      }
      const msg = error instanceof Error ? error.message : String(error);
      const rateLimited =
        releaseOutcome === "rate_limit" || isLlmRateLimitHttpFailure(error);
      if (rateLimited) {
        console.warn(
          `[Groq Key #${keyIndex + 1}] LIMIT HIT - rotating to next key`,
        );
        mergedGroqCooldowns = {
          ...mergedGroqCooldowns,
          [key]: Date.now() + readGroqSoftFailureCooldownMs(),
        };
        if (!usePreemptive) {
          nextGroqKeyIndex = (keyIndex + 1) % groqKeys.length;
          await patchAiQuotaState({
            groq_key_cooldowns: mergedGroqCooldowns,
            current_groq_key_index: nextGroqKeyIndex,
          });
        }
        await logGroqKeyLimit(keyIndex);
        if (isSoftQuotaOrRateLimit(msg)) {
          const laneKeysLeft = countLanePoolKeysEligible(
            rotationOrder,
            (i) => groqVetoPoolKeyId(i),
            (i) => {
              const assigned = usePreemptive && i === preferredGroqKeyIndex;
              const k = String(groqKeys[i] ?? "").trim();
              return (
                Number(mergedGroqCooldowns[k] ?? 0) > Date.now() && !assigned
              );
            },
            keyIndex,
          );
          if (laneKeysLeft <= 0) {
            console.warn(
              `[AI DEBUG] groq_veto lane ${symbol} — no alternate keys after 429 (key pool)`,
            );
            break;
          }
          console.warn(
            `[AI DEBUG] groq_veto 429 key #${keyIndex + 1} — lane ${symbol} tries next (${laneKeysLeft} left)`,
          );
          continue;
        }
        continue;
      }
      console.warn(`[binance-bot] Groq veto check skipped: ${msg}`);
      return { ai, nextGroqKeyIndex };
    }
  }
  return { ai, nextGroqKeyIndex };
}

type GroqReviewResult = {
  action: "APPROVE" | "REJECT";
  reason: string;
  confidence?: number;
  confidenceScore?: number;
  buyAction?: "BUY" | "HOLD";
};

async function groqCascadeGatekeeperReview(
  groqKey: string,
  data: unknown,
  signal?: AbortSignal,
  timeoutOpts?: LlmPerKeyTimeoutOpts,
): Promise<GroqReviewResult> {
  const parsed = await groqJsonCompletion(
    groqKey,
    GROQ_GATEKEEPER_LEAN_SYSTEM,
    data,
    signal,
    resolveGroqTrapModel(90),
    timeoutOpts,
    96,
  );
  const actionRaw = String(parsed.action ?? "HOLD").toUpperCase();
  const buyAction = actionRaw === "BUY" ? "BUY" : "HOLD";
  const scoreRaw = Number(parsed.confidenceScore ?? parsed.confidence);
  const confidenceScore = Number.isFinite(scoreRaw)
    ? Math.min(100, Math.max(0, Math.floor(scoreRaw)))
    : undefined;
  return {
    action: buyAction === "BUY" ? "APPROVE" : "REJECT",
    buyAction,
    reason: String(
      parsed.reasoning ?? parsed.reason ?? "cascade_gatekeeper",
    ).slice(0, 300),
    confidenceScore,
    confidence: confidenceScore,
  };
}

async function groqTrapReview(
  groqKey: string,
  data: unknown,
  signal?: AbortSignal,
  scannerConfidence = NaN,
  timeoutOpts?: LlmPerKeyTimeoutOpts,
): Promise<GroqReviewResult> {
  const groqModel = resolveGroqTrapModel(scannerConfidence);
  try {
    const parsed = await groqJsonCompletion(
      groqKey,
      GROQ_TRAP_REVIEW_SYSTEM,
      data,
      signal,
      groqModel,
      timeoutOpts,
      180,
    );
    const actionRaw = String(parsed.action ?? "REJECT").toUpperCase();
    return {
      action: actionRaw.startsWith("APPROVE") ? "APPROVE" : "REJECT",
      reason: String(parsed.reasoning ?? parsed.reason ?? "no_reason").slice(
        0,
        300,
      ),
      confidence: parsed.confidence,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[AI DEBUG] groq_execution_failed detail=${detail}`);
    throw error;
  }
}

async function groqJsonCompletion(
  groqKey: string,
  systemContent: string,
  data: unknown,
  signal: AbortSignal | undefined,
  groqModel: string,
  timeoutOpts: LlmPerKeyTimeoutOpts | undefined,
  maxTokens: number,
): Promise<{
  action?: string;
  reasoning?: string;
  reason?: string;
  confidence?: number;
}> {
  await enforceGroqRequestSpacing(signal);
  const fetchSignal =
    timeoutOpts?.dbHardTimeoutMs != null
      ? AbortSignal.any([
          signal ?? AbortSignal.timeout(120_000),
          AbortSignal.timeout(timeoutOpts.dbHardTimeoutMs),
        ])
      : signal;
  const response = await fetchWithExponentialBackoff(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: groqModel,
        temperature: 0.1,
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: JSON.stringify(data) },
        ],
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
      }),
    },
    0,
    fetchSignal,
  );
  if (!response.ok) {
    const text = await response.text();
    throw new LlmHttpError(
      `Groq review error: ${response.status} model=${groqModel} body=${text.slice(0, 300)}`,
      response.status,
      text,
    );
  }
  const json = await response.json();
  const vetoSym = String(
    (data as Record<string, unknown>)?.symbol ?? "UNKNOWN",
  ).toUpperCase();
  emitGroqTelemetry(vetoSym, "groq_veto", json);
  const parsed = safeJsonParseFromText(
    sanitizeModelTextForJson(
      String(json?.choices?.[0]?.message?.content ?? ""),
    ),
  ) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") {
    return { action: "APPROVE", reasoning: "parser_fallback" };
  }
  const confidenceRaw = Number(parsed.confidence);
  return {
    ...parsed,
    confidence: Number.isFinite(confidenceRaw)
      ? Math.min(100, Math.max(0, confidenceRaw))
      : undefined,
  };
}

function sanitizeModelTextForJson(rawText: string) {
  const brace = rawText.trim().match(/\{[\s\S]*\}/);
  return brace ? brace[0].trim() : rawText.trim();
}
