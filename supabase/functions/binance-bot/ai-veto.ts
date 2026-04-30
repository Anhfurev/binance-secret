// @ts-nocheck
import type { AiAnalysis, IndicatorSnapshot } from "./types.ts";
import { safeJsonParseFromText } from "./utils.ts";

const DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant";
const GROQ_TRAP_REVIEW_SYSTEM = [
  "You are a cynical Wall Street whale.",
  "Gemini wants to BUY this coin. Your job is to find the lie.",
  "Check for trap conditions: price rising while volume declines (bearish divergence), obvious blow-off moves, suspicious sell pressure.",
  "If symbol is PEPEUSDT, prioritize volume spikes and social sentiment risk signals over standard RSI/MACD.",
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
      const review = await groqTrapReview(key, {
        symbol,
        rsi: snapshot.rsi,
        latestPrice: snapshot.latestPrice,
        market_context: { imbalance_ratio: snapshot.imbalance_ratio },
        symbol_strategy_hint: buildSymbolStrategyHint(symbol),
        last15mPriceAction: snapshot.candles15.map((c) => ({ ...c })),
      }, signal);
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
      if (msg.includes("QUOTA_EXHAUSTED")) {
        console.warn(`[Groq Key #${keyIndex + 1}] LIMIT HIT - Rotating...`);
        await logGroqKeyLimit(keyIndex);
        continue;
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
