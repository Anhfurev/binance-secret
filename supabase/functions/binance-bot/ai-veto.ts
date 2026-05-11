// @ts-nocheck
import type { AiAnalysis, IndicatorSnapshot } from "./types.ts";
import { envLlmTimeoutMs, mergeLlmAbortSignal } from "./ai-models.ts";
import { safeJsonParseFromText } from "./utils.ts";
import {
  buildVetoTechnicalWindow,
  evaluateStaleSignalVeto,
  shouldFastTrackGroqBuyVeto,
} from "./ai-veto-helpers.ts";
import { withLlmConcurrency } from "./ai-llm-concurrency.ts";

const DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant";
const GROQ_TRAP_REVIEW_SYSTEM = [
  "You are a cynical Wall Street whale.",
  "Gemini wants to BUY this coin. Your job is to find the lie.",
  "You are given veto_window: last five 1m OHLCV bars (oldest→newest), last five 15m bars, and computed short-horizon returns.",
  "The primary BUY signal may be stale (seconds of latency). If recent 1m closes or ticker vs last 1m close clearly contradict a long, REJECT.",
  "Check for trap conditions: price rising while volume declines (bearish divergence), obvious blow-off moves, suspicious sell pressure.",
  "If symbol is PEPEUSDT, prioritize volume spikes and social sentiment risk signals over standard RSI/MACD.",
  "Base your verdict on the provided numbers only — do not invent candle data.",
  'Return ONLY JSON: { "action": "APPROVE" | "REJECT", "reason": "<short reason>" }.',
].join(" ");

export function buildSymbolStrategyHint(symbol: string) {
  if (String(symbol).toUpperCase() === "PEPEUSDT") {
    return {
      priority: "volume_spikes_and_social_sentiment",
      note:
        "For PEPEUSDT, prefer volume acceleration and sentiment-driven momentum over classical RSI/MACD neutrality.",
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
  } = params;
  let nextGroqKeyIndex = params.currentGroqKeyIndex;
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
        raw_groq_veto_response: { action: "REJECT", reason: stale.reason, fast_path: true },
      },
      nextGroqKeyIndex,
    };
  }

  if (shouldFastTrackGroqBuyVeto(ai)) {
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

  nextGroqKeyIndex = (nextGroqKeyIndex + 1) % groqKeys.length;
  const startIndex = nextGroqKeyIndex;
  for (let attempt = 0; attempt < groqKeys.length; attempt += 1) {
    const keyIndex = (startIndex + attempt) % groqKeys.length;
    const key = (groqKeys[keyIndex] ?? "").trim();
    if (!key) {
      console.warn(
        `[AI DEBUG] groq_key_missing_or_empty symbol=${symbol} key_index=${keyIndex + 1} attempt=${attempt + 1}`,
      );
      continue;
    }
    try {
      console.log(
        `[AI DEBUG] groq_path_selected symbol=${symbol} key_index=${keyIndex + 1} attempt=${attempt + 1}`,
      );
      const vetoSignal = mergeLlmAbortSignal(
        signal,
        envLlmTimeoutMs("GROQ_VETO_TIMEOUT_MS", 8000),
      );
      const veto_window = buildVetoTechnicalWindow(snapshot);
      const review = await withLlmConcurrency(() =>
        groqTrapReview(key, {
          symbol,
          rsi: snapshot.rsi,
          latestPrice: snapshot.latestPrice,
          market_context: { imbalance_ratio: snapshot.imbalance_ratio },
          symbol_strategy_hint: buildSymbolStrategyHint(symbol),
          veto_window,
        }, vetoSignal)
      );
      await logGroqKeySuccess(keyIndex);
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
      return {
        ai: {
          ...ai,
          groq_verdict: "APPROVE",
          groq_reason: review.reason,
          raw_groq_veto_response: review,
        },
        nextGroqKeyIndex,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const rateLimited = msg.includes("QUOTA_EXHAUSTED") ||
        msg.includes("429") ||
        /rate limit/i.test(msg);
      if (rateLimited) {
        console.warn(`[Groq Key #${keyIndex + 1}] LIMIT HIT - fast-fail veto`);
        await logGroqKeyLimit(keyIndex);
        return { ai, nextGroqKeyIndex: keyIndex };
      }
      console.warn(`[binance-bot] Groq veto check skipped: ${msg}`);
      return { ai, nextGroqKeyIndex };
    }
  }
  return { ai, nextGroqKeyIndex };
}

async function groqTrapReview(
  groqKey: string,
  data: unknown,
  signal?: AbortSignal,
): Promise<{ action: "APPROVE" | "REJECT"; reason: string }> {
  const groqModel = (Deno.env.get("GROQ_MODEL") ?? "").trim() || DEFAULT_GROQ_MODEL;
  try {
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
            { role: "system", content: GROQ_TRAP_REVIEW_SYSTEM },
            { role: "user", content: JSON.stringify(data) },
          ],
          response_format: { type: "json_object" },
          max_tokens: 180,
        }),
      },
      2,
      signal,
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Groq trap review error: ${response.status} model=${groqModel} body=${text.slice(0, 300)}`,
      );
    }
    const json = await response.json();
    const parsed = safeJsonParseFromText(
      sanitizeModelTextForJson(String(json?.choices?.[0]?.message?.content ?? "")),
    ) as any;
    const actionRaw = String(parsed?.action ?? "APPROVE").toUpperCase();
    return {
      action: actionRaw === "REJECT" ? "REJECT" : "APPROVE",
      reason: String(parsed?.reason ?? "no_reason").slice(0, 300),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[AI DEBUG] groq_execution_failed detail=${detail}`);
    throw error;
  }
}

function sanitizeModelTextForJson(rawText: string) {
  const brace = rawText.trim().match(/\{[\s\S]*\}/);
  return brace ? brace[0].trim() : rawText.trim();
}

async function fetchWithExponentialBackoff(
  url: string,
  init: RequestInit,
  retries: number,
  signal?: AbortSignal,
): Promise<Response> {
  if (signal?.aborted) {
    throw new Error("CYCLE_ABORTED:groq_veto");
  }
  let attempt = 0;
  let response = await fetch(url, { ...init, signal });
  while (attempt < retries && response.status === 429) {
    const waitMs = 2 ** attempt * 1000 + Math.floor(Math.random() * 500);
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    if (signal?.aborted) {
      throw new Error("CYCLE_ABORTED:groq_veto");
    }
    response = await fetch(url, { ...init, signal });
    attempt += 1;
  }
  return response;
}
