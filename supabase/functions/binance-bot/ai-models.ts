// @ts-nocheck
import type { AiAnalysis } from "./types.ts";
import { resolveGroqScanModel } from "./ai-groq-models.ts";
import {
  GROQ_SCAN_SYSTEM_MINIMAL,
  readGroqScanMinimalSystemEnabled,
} from "./ai-groq-scan-prompt.ts";
import { enforceGroqRequestSpacing } from "./groq-request-spacing.ts";
import { LlmHttpError } from "./llm-http-error.ts";
import { normalizeAiResponse } from "./ai-normalize-model-response.ts";
export { normalizeAiResponse };
import {
  emitGeminiTelemetry,
  emitGroqTelemetry,
} from "./ai-llm-telemetry.ts";

export const AI_SYSTEM_REST_API = [
  "IMPORTANT: You are a REST API.",
  "You must return ONLY a raw JSON object — the response body is exactly one JSON object, nothing before or after it.",
  "Do NOT output a final confidence field; the server computes a weighted score from your sub-scores.",
  "Required keys:",
  '  "trend_score" (0-100): 1h vs short-term alignment. "momentum_score" (0-100): RSI/MACD quality vs history.',
  '  "volume_score" (0-100): surge vs baseline. "order_book_score" (0-100): imbalance_ratio vs tape.',
  '  "trend_alignment": <boolean> — short-term agrees with higher timeframe trend.',
  '  "action": "BUY" | "SELL" | "HOLD"',
  '  "pro_tip": string — EXACTLY one 15-word actionable tip for the UI explaining entry risk (e.g. "Entry safe, but 1h RSI is approaching overbought—tighten Stop Loss"). No extra sentences.',
  "Do not include markdown, code fences, URLs, or text outside the JSON.",
  "Use DATA OHLCV tuples + marketRegime/adx14; RANGING still allows volume thrust vs avgVolume1m; imbalance_ratio>2.5 can lift order_book_score.",
  "Meme symbols: liquidity-aware volume_score/pro_tip. Momentum: spikes/micro-bounces; WEAK_BULLISH in pro_tip if edge 60–72%. sandbox_mode may +20 conf if recovering tape.",
  "Respect trend_htf.mtf_effective_ok (false → HOLD on MTF conflict). Use candles1h/candles4h tuples for HTF direction.",
].join(" ");

export const AI_USER_DATA_PREFIX =
  "Analyze the following DATA and respond with the JSON object only:\n";

const GEMINI_MODEL = "gemini-2.5-flash-lite";
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

function redactGeminiErrorText(text: string): string {
  return String(text ?? "")
    .replace(/AIzaSy[a-zA-Z0-9_-]{10,}/g, "AIzaSy…")
    .replace(/api_key:[^"'\s]+/gi, "api_key:…")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer …")
    .slice(0, 400);
}

function resolveTelemetrySymbol(data: unknown, explicit?: string): string {
  const e = String(explicit ?? "").trim();
  if (e) return e.toUpperCase();
  try {
    const o = data as Record<string, unknown>;
    if (o && typeof o.symbol === "string") return String(o.symbol).toUpperCase();
  } catch {
    /* ignore */
  }
  return "UNKNOWN";
}

export type LlmPerKeyTimeoutOpts = { dbHardTimeoutMs?: number };

export async function geminiAnalyze(
  geminiKey: string,
  data: unknown,
  signal?: AbortSignal,
  telemetrySymbol?: string,
  opts?: LlmPerKeyTimeoutOpts,
): Promise<AiAnalysis> {
  const url = `${GEMINI_BASE_URL}${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(geminiKey)}`;
  const userText = `${AI_USER_DATA_PREFIX}${JSON.stringify(data)}`;
  const envCap = envLlmTimeoutMs("GEMINI_REQUEST_TIMEOUT_MS", 12_000);
  const capMs = opts?.dbHardTimeoutMs != null ? Math.min(envCap, opts.dbHardTimeoutMs) : envCap;
  const reqSignal = mergeLlmAbortSignal(signal, capMs);
  const response = await fetchGemini(url, userText, reqSignal);
  if (!response.ok) {
    const text = await response.text();
    const safe = redactGeminiErrorText(text);
    console.error(`Gemini error: ${response.status} ${safe.slice(0, 300)}`);
    throw new LlmHttpError(`Gemini status ${response.status}: ${safe}`, response.status, safe);
  }
  const json = await response.json();
  const text = (json?.candidates ?? [])
    .flatMap((candidate: any) => candidate?.content?.parts ?? [])
    .map((part: any) => part?.text ?? "")
    .join("");
  emitGeminiTelemetry(resolveTelemetrySymbol(data, telemetrySymbol), "gemini", json);
  return normalizeAiResponse(text);
}

async function fetchGemini(
  url: string,
  userText: string,
  signal?: AbortSignal,
) {
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
    const t = await response.text().catch(() => "");
    throw new LlmHttpError(
      "QUOTA_EXHAUSTED: Gemini returned 429 (immediate fallback enabled)",
      429,
      t,
    );
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
  telemetrySymbol?: string,
  opts?: LlmPerKeyTimeoutOpts,
): Promise<AiAnalysis> {
  const groqModel = resolveGroqScanModel();
  const userText = `${AI_USER_DATA_PREFIX}${JSON.stringify(data)}`;
  const envCap = envLlmTimeoutMs("GROQ_REQUEST_TIMEOUT_MS", 10_000);
  const capMs = opts?.dbHardTimeoutMs != null ? Math.min(envCap, opts.dbHardTimeoutMs) : envCap;
  const reqSignal = mergeLlmAbortSignal(signal, capMs);
  await enforceGroqRequestSpacing(reqSignal);
  const systemContent = readGroqScanMinimalSystemEnabled()
    ? GROQ_SCAN_SYSTEM_MINIMAL
    : AI_SYSTEM_REST_API;
  /** No intra-key 429 backoff — `tryGroqFlow` / circuit breaker rotates keys without multi-second stalls. */
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
          { role: "system", content: systemContent },
          { role: "user", content: userText },
        ],
        response_format: { type: "json_object" },
        max_tokens: 512,
      }),
    },
    0,
    reqSignal,
  );
  if (response.status === 429) {
    const t = await response.text().catch(() => "");
    throw new LlmHttpError(
      "QUOTA_EXHAUSTED: Groq returned 429 (no intra-key retry)",
      429,
      t.slice(0, 400),
    );
  }
  if (!response.ok) {
    const text = await response.text();
    throw new LlmHttpError(
      `Groq error: ${response.status} model=${groqModel} body=${text.slice(0, 300)}`,
      response.status,
      text,
    );
  }
  const json = await response.json();
  emitGroqTelemetry(resolveTelemetrySymbol(data, telemetrySymbol), "groq", json);
  return normalizeAiResponse(json?.choices?.[0]?.message?.content ?? "");
}

async function fetchWithOne429Retry(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  let res = await fetch(url, { ...init, signal });
  if (res.status === 429) {
    await delay(RATE_LIMIT_RETRY_MS);
    if (signal?.aborted) throw new Error("CYCLE_ABORTED:openai");
    res = await fetch(url, { ...init, signal });
  }
  return res;
}

export async function fetchWithExponentialBackoff(
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
  return new Promise<void>((r) => setTimeout(r, ms));
}
