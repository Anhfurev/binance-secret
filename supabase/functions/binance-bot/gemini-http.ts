// @ts-nocheck
/** Gemini generateContent HTTP — minified JSON mode + optional context cache. */

import { pooledFetch } from "./pooled-http-client.ts";
import { LlmHttpError } from "./llm-http-error.ts";
import { resolveGeminiCachedContent, type GeminiCacheProfile } from "./gemini-context-cache.ts";
import { readGeminiModelId } from "./gemini-context-cache.ts";
import {
  isGeminiCachePayloadClientError,
  isGeminiContextCacheEligible,
} from "./gemini-token-estimate.ts";

export function readGeminiMaxOutputTokens(): number {
  const raw = Number(Deno.env.get("GEMINI_MAX_OUTPUT_TOKENS") ?? "192");
  if (!Number.isFinite(raw)) return 192;
  return Math.min(512, Math.max(64, Math.floor(raw)));
}

/** Low temperature = fast, deterministic signals (`GEMINI_TEMPERATURE`, default 0.1). */
export function readGeminiTemperature(): number {
  const raw = Number(Deno.env.get("GEMINI_TEMPERATURE") ?? "0.1");
  if (!Number.isFinite(raw)) return 0.1;
  return Math.min(0.4, Math.max(0, raw));
}

export function buildGeminiGenerationConfig(): Record<string, unknown> {
  return {
    temperature: readGeminiTemperature(),
    maxOutputTokens: readGeminiMaxOutputTokens(),
    responseMimeType: "application/json",
    candidateCount: 1,
  };
}

export type GeminiGenerateOpts = {
  apiKey: string;
  userText: string;
  systemInstruction: string;
  cacheProfile?: GeminiCacheProfile;
  signal?: AbortSignal;
  maxOutputTokens?: number;
  /** Override scan model (e.g. `models/gemini-1.5-pro` for hourly macro). */
  modelId?: string;
  temperature?: number;
};

async function postGeminiGenerateContent(
  opts: GeminiGenerateOpts,
  cachedContent: string | null,
): Promise<Response> {
  const model = String(opts.modelId ?? readGeminiModelId()).replace(/^models\//, "");
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${
      encodeURIComponent(opts.apiKey)
    }`;
  const generationConfig = buildGeminiGenerationConfig();
  if (opts.maxOutputTokens != null) {
    generationConfig.maxOutputTokens = opts.maxOutputTokens;
  }
  if (opts.temperature != null) {
    generationConfig.temperature = opts.temperature;
  }
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.userText }] }],
    generationConfig,
  };
  if (cachedContent) {
    body.cachedContent = cachedContent;
  } else {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }
  return pooledFetch(url, {
    signal: opts.signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function geminiGenerateContent(
  opts: GeminiGenerateOpts,
): Promise<Response> {
  const cacheWanted = Boolean(opts.cacheProfile) && !opts.modelId &&
    isGeminiContextCacheEligible(opts.systemInstruction, opts.userText);
  const cachedContent = cacheWanted && opts.cacheProfile
    ? await resolveGeminiCachedContent(
      opts.apiKey,
      opts.cacheProfile,
      opts.systemInstruction,
      opts.signal,
    )
    : null;

  let response = await postGeminiGenerateContent(opts, cachedContent);

  if (response.status === 400 && cachedContent) {
    const text = await response.text().catch(() => "");
    if (isGeminiCachePayloadClientError(text)) {
      response = await postGeminiGenerateContent(opts, null);
    } else {
      throw new LlmHttpError(`Gemini status 400: ${text.slice(0, 200)}`, 400, text);
    }
  }

  if (response.status === 400) {
    const text = await response.text().catch(() => "");
    throw new LlmHttpError(`Gemini status 400: ${text.slice(0, 200)}`, 400, text);
  }

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

export function extractGeminiText(json: unknown): string {
  const root = json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return (root?.candidates ?? [])
    .flatMap((candidate) => candidate?.content?.parts ?? [])
    .map((part) => part?.text ?? "")
    .join("");
}
