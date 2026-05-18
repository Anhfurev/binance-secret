// @ts-nocheck
import type { AiAnalysis } from "./types.ts";
import { resolveGroqScanModel } from "./ai-groq-models.ts";
import {
  GROQ_SCAN_SYSTEM_MINIMAL,
  readGroqScanMinimalSystemEnabled,
} from "./ai-groq-scan-prompt.ts";
import { enforceGroqRequestSpacing } from "./groq-request-spacing.ts";
import { pooledFetch } from "./pooled-http-client.ts";
import { LlmHttpError } from "./llm-http-error.ts";
import { normalizeAiResponse } from "./ai-normalize-model-response.ts";
export { normalizeAiResponse };
import {
  emitGeminiTelemetry,
  emitGroqTelemetry,
} from "./ai-llm-telemetry.ts";

export {
  AI_SYSTEM_REST_API,
  GEMINI_SCAN_SYSTEM_MINIFIED,
  buildGeminiScanSystemForCache,
} from "./gemini-prompt-config.ts";
import { buildGeminiScanSystemForCache } from "./gemini-prompt-config.ts";
import { extractGeminiText, geminiGenerateContent } from "./gemini-http.ts";
import { stringifyGeminiUserData } from "./gemini-user-payload.ts";

/** Groq/OpenAI user prefix (Gemini uses `stringifyGeminiUserData` → `D:{...}`). */
export const AI_USER_DATA_PREFIX =
  "Analyze the following DATA and respond with the JSON object only:\n";

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

/** Matrix-primary Gemini scan ceiling (`GEMINI_PRIMARY_MATRIX_TIMEOUT_MS`, default 6s). */
export function readGeminiPrimaryMatrixTimeoutMs(): number {
  const n = Number(Deno.env.get("GEMINI_PRIMARY_MATRIX_TIMEOUT_MS") ?? "6000");
  if (!Number.isFinite(n) || n < 3000) return 6000;
  return Math.min(10_000, Math.floor(n));
}

export function resolveGeminiRequestCapMs(
  opts?: LlmPerKeyTimeoutOpts & { primaryMatrixTimeoutMs?: number },
): number {
  const envCap = envLlmTimeoutMs("GEMINI_REQUEST_TIMEOUT_MS", 12_000);
  let capMs = envCap;
  if (opts?.dbHardTimeoutMs != null) capMs = Math.min(capMs, opts.dbHardTimeoutMs);
  if (opts?.primaryMatrixTimeoutMs != null) {
    capMs = Math.min(capMs, opts.primaryMatrixTimeoutMs);
  }
  return capMs;
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

export type LlmPerKeyTimeoutOpts = {
  dbHardTimeoutMs?: number;
  /** Provider-matrix primary scan — hard cap before Groq rescue (see `readGeminiPrimaryMatrixTimeoutMs`). */
  primaryMatrixTimeoutMs?: number;
  /** Override system prompt (3-tier cascade scanner). */
  systemInstruction?: string;
  /** Override response normalizer (cascade JSON schema). */
  normalizeResponse?: (text: string) => AiAnalysis;
  userTextPrefix?: string;
  /** Explicit context cache profile (`scan` default, `cascade` for tier-2). */
  cacheProfile?: import("./gemini-context-cache.ts").GeminiCacheProfile;
};

export async function geminiAnalyze(
  geminiKey: string,
  data: unknown,
  signal?: AbortSignal,
  telemetrySymbol?: string,
  opts?: LlmPerKeyTimeoutOpts,
): Promise<AiAnalysis> {
  const userText = opts?.userTextPrefix
    ? `${opts.userTextPrefix}${JSON.stringify(data)}`
    : stringifyGeminiUserData(data);
  const capMs = resolveGeminiRequestCapMs(opts);
  const reqSignal = mergeLlmAbortSignal(signal, capMs);
  const system = opts?.systemInstruction ?? buildGeminiScanSystemForCache();
  const normalize = opts?.normalizeResponse ?? normalizeAiResponse;
  const cacheProfile = opts?.cacheProfile ?? "scan";
  const response = await geminiGenerateContent({
    apiKey: geminiKey,
    userText,
    systemInstruction: system,
    cacheProfile,
    signal: reqSignal,
  });
  if (!response.ok) {
    const text = await response.text();
    const safe = redactGeminiErrorText(text);
    console.error(`Gemini error: ${response.status} ${safe.slice(0, 300)}`);
    throw new LlmHttpError(`Gemini status ${response.status}: ${safe}`, response.status, safe);
  }
  const json = await response.json();
  const text = extractGeminiText(json);
  emitGeminiTelemetry(resolveTelemetrySymbol(data, telemetrySymbol), "gemini", json);
  return normalize(text);
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
  let res = await pooledFetch(url, { ...init, signal });
  if (res.status === 429) {
    await delay(RATE_LIMIT_RETRY_MS);
    if (signal?.aborted) throw new Error("CYCLE_ABORTED:openai");
    res = await pooledFetch(url, { ...init, signal });
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
  let response = await pooledFetch(url, { ...init, signal });
  while (attempt < retries && response.status === 429) {
    const waitMs = 2 ** attempt * 1000 + Math.floor(Math.random() * 500);
    await delay(waitMs);
    if (signal?.aborted) throw new Error("CYCLE_ABORTED:llm");
    response = await pooledFetch(url, { ...init, signal });
    attempt += 1;
  }
  return response;
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
