// @ts-nocheck
import type { AiAnalysis } from "./types.ts";
import {
  computeWeightedConfidence,
  truncateProTip,
} from "./ai-scoring.ts";
import { safeJsonParseFromText, toNumber } from "./utils.ts";

const AI_SYSTEM_REST_API = [
  "IMPORTANT: You are a REST API.",
  "You must return ONLY a raw JSON object — the response body is exactly one JSON object, nothing before or after it.",
  "Do NOT output a final confidence field; the server computes a weighted score from your sub-scores.",
  "Required keys:",
  '  "trend_score" (0-100, number): 40% weight — compare 1h trend direction vs 5m/short-term direction; higher when they align bullish/bearish consistently.',
  '  "momentum_score" (0-100, number): 30% weight — RSI and MACD positioning vs recent history (overbought/oversold quality, not a single threshold).',
  '  "volume_score" (0-100, number): 20% weight — is there a credible breakout volume surge vs recent baseline?',
  '  "order_book_score" (0-100, number): 10% weight — buy vs sell wall pressure using market_context.imbalance_ratio and price action (higher when bid-side supportive).',
  '  "trend_alignment": <boolean> — short-term agrees with higher timeframe trend.',
  '  "action": "BUY" | "SELL" | "HOLD"',
  '  "pro_tip": string — EXACTLY one 15-word actionable tip for the UI explaining entry risk (e.g. "Entry safe, but 1h RSI is approaching overbought—tighten Stop Loss"). No extra sentences.',
  "Do not include markdown, code fences, URLs, or text outside the JSON.",
  "Use 1m/15m/1h fields in DATA. DATA includes marketRegime and adx14 (1h): RANGING = low ADX + tight range — favor dip/mean-reversion in sub-scores; TRENDING = ADX>25 — trend alignment matters. Avoid breakout-style BUY scores in RANGING unless volume is exceptional.",
  "If market_context.imbalance_ratio > 2.5 and no contradiction, you may raise order_book_score and consider BUY when other scores support.",
  "If symbol_strategy_hint targets meme/volatile symbols, weight volume_score and pro_tip toward liquidity and trap risk.",
  "Senior Technical Analyst mode: You are not a yes-man. Sub-scores must reflect real tape quality.",
  "WAIT / conviction: Output action \"BUY\" if your internal aggregate conviction (from sub-scores) would map to >72% on a 0–100 scale. If conviction would sit below 60%, output action \"HOLD\", keep scores honest, and put the phrase WEAK_BULLISH in pro_tip when conviction is 60–72% (still max 15 words total for pro_tip).",
  "Testnet aggression: If DATA.sandbox_mode is true and setup shows recovering trend (price > ema50, RSI climbing, trend not bearish), you may boost conviction by up to +20 points before deciding action.",
  "200 EMA: If DATA.latestPrice is below DATA.ema200, normally forbid BUY. Exception (recovery): if price is above DATA.ema50 AND RSI is climbing from recent bars, you may output BUY with lower sub-scores and note RECOVERY in pro_tip (still respect DATA.trend_htf.mtf_effective_ok).",
  "Multi-timeframe: Prefer DATA.trend_htf.mtf_effective_ok. If true (either strict 1h/4h aligned OR 15m/1h aligned via mtf_ltf_aligned), MTF is acceptable for BUY. If mtf_effective_ok is false, output HOLD on timeframe conflict.",
  "Use DATA.candles1h and DATA.candles4h (last bars) when reasoning about higher-timeframe direction in your sub-scores.",
].join(" ");

const AI_USER_DATA_PREFIX =
  "Analyze the following DATA and respond with the JSON object only:\n";

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant";
const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/";
const RATE_LIMIT_RETRY_MS = 2000;

/** Merge cycle `AbortSignal` with a hard cap so hung LLM HTTP never blocks the bot for minutes. */
export function mergeLlmAbortSignal(
  cycleSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const ms = Math.min(Math.max(timeoutMs, 2000), 120_000);
  const deadline = AbortSignal.timeout(ms);
  if (!cycleSignal) return deadline;
  return AbortSignal.any([cycleSignal, deadline]);
}

export function envLlmTimeoutMs(envKey: string, defaultMs: number): number {
  const n = Number(Deno.env.get(envKey) ?? "");
  if (!Number.isFinite(n) || n < 2000) return defaultMs;
  return Math.min(n, 120_000);
}

export async function geminiAnalyze(
  geminiKey: string,
  data: unknown,
  signal?: AbortSignal,
): Promise<AiAnalysis> {
  const url = `${GEMINI_BASE_URL}${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(geminiKey)}`;
  const userText = `${AI_USER_DATA_PREFIX}${JSON.stringify(data)}`;
  const reqSignal = mergeLlmAbortSignal(
    signal,
    envLlmTimeoutMs("GEMINI_REQUEST_TIMEOUT_MS", 12_000),
  );
  const response = await fetchGemini(url, userText, reqSignal);
  if (!response.ok) {
    const text = await response.text();
    console.error(`Gemini error: ${response.status} ${text.slice(0, 300)}`);
    throw new Error(`Gemini status ${response.status}`);
  }
  const json = await response.json();
  const text = (json?.candidates ?? [])
    .flatMap((candidate: any) => candidate?.content?.parts ?? [])
    .map((part: any) => part?.text ?? "")
    .join("");
  return normalizeAiResponse(text);
}

async function fetchGemini(url: string, userText: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userText }] }],
      systemInstruction: { parts: [{ text: AI_SYSTEM_REST_API }] },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512,
        responseMimeType: "application/json",
      },
    }),
  });
  if (response.status === 429) {
    throw new Error("QUOTA_EXHAUSTED: Gemini returned 429 (immediate fallback enabled)");
  }
  return response;
}

export async function openAiAnalyze(
  openaiKey: string,
  data: unknown,
  signal?: AbortSignal,
): Promise<AiAnalysis> {
  const userText = `${AI_USER_DATA_PREFIX}${JSON.stringify(data)}`;
  const reqSignal = mergeLlmAbortSignal(
    signal,
    envLlmTimeoutMs("OPENAI_REQUEST_TIMEOUT_MS", 14_000),
  );
  const response = await fetchWithOne429Retry(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: AI_SYSTEM_REST_API },
          { role: "user", content: userText },
        ],
        response_format: { type: "json_object" },
        max_tokens: 512,
      }),
    },
    reqSignal,
  );
  if (!response.ok) {
    throw new Error(`OpenAI error: ${response.status}`);
  }
  const json = await response.json();
  return normalizeAiResponse(json?.choices?.[0]?.message?.content ?? "");
}

export async function groqAnalyze(
  groqKey: string,
  data: unknown,
  signal?: AbortSignal,
): Promise<AiAnalysis> {
  const groqModel = (Deno.env.get("GROQ_MODEL") ?? "").trim() || DEFAULT_GROQ_MODEL;
  const userText = `${AI_USER_DATA_PREFIX}${JSON.stringify(data)}`;
  const reqSignal = mergeLlmAbortSignal(
    signal,
    envLlmTimeoutMs("GROQ_REQUEST_TIMEOUT_MS", 10_000),
  );
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
        temperature: 0.2,
        messages: [
          { role: "system", content: AI_SYSTEM_REST_API },
          { role: "user", content: userText },
        ],
        response_format: { type: "json_object" },
        max_tokens: 512,
      }),
    },
    2,
    reqSignal,
  );
  if (response.status === 429) {
    throw new Error("QUOTA_EXHAUSTED: Groq returned 429 after retries");
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq error: ${response.status} model=${groqModel} body=${text.slice(0, 300)}`);
  }
  const json = await response.json();
  return normalizeAiResponse(json?.choices?.[0]?.message?.content ?? "");
}

function normalizeAiResponse(text: string): AiAnalysis {
  const parsed = safeJsonParseFromText(sanitizeModelTextForJson(String(text ?? ""))) as any;
  const alignment = Boolean(parsed?.trend_alignment);
  const actionRaw = String(parsed?.action ?? "HOLD").toUpperCase();
  const action = actionRaw === "BUY" || actionRaw === "SELL"
    ? actionRaw
    : "HOLD";
  const trend = action === "BUY" ? "bullish" : action === "SELL" ? "bearish" : "neutral";
  const trend_score = clamp01to100(toNumber(parsed?.trend_score, 0));
  const momentum_score = clamp01to100(toNumber(parsed?.momentum_score, 0));
  const volume_score = clamp01to100(toNumber(parsed?.volume_score, 0));
  const order_book_score = clamp01to100(toNumber(parsed?.order_book_score, 0));
  const pro_tip = truncateProTip(String(parsed?.pro_tip ?? ""));

  const base: AiAnalysis = {
    ai_confidence: 0,
    trend,
    trend_alignment: alignment,
    action,
    trend_score,
    momentum_score,
    volume_score,
    order_book_score,
    pro_tip: pro_tip || undefined,
    raw_ai_response: parsed,
  };
  base.ai_confidence = computeWeightedConfidence(base);
  return base;
}

function clamp01to100(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sanitizeModelTextForJson(rawText: string) {
  const brace = rawText.trim().match(/\{[\s\S]*\}/);
  return brace ? brace[0].trim() : rawText.trim();
}

async function fetchWithOne429Retry(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  let res = await fetch(url, { ...init, signal });
  if (res.status === 429) {
    await delay(RATE_LIMIT_RETRY_MS);
    if (signal?.aborted) throw new Error("CYCLE_ABORTED:openai");
    res = await fetch(url, { ...init, signal });
  }
  return res;
}

async function fetchWithExponentialBackoff(
  url: string,
  init: RequestInit,
  retries: number,
  signal?: AbortSignal,
): Promise<Response> {
  if (signal?.aborted) throw new Error("CYCLE_ABORTED:llm");
  let attempt = 0;
  let response = await fetch(url, { ...init, signal });
  while (attempt < retries && response.status === 429) {
    const waitMs = 2 ** attempt * 1000 + Math.floor(Math.random() * 500);
    await delay(waitMs);
    if (signal?.aborted) throw new Error("CYCLE_ABORTED:llm");
    response = await fetch(url, { ...init, signal });
    attempt += 1;
  }
  return response;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
