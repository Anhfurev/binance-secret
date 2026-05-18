// @ts-nocheck
/** Gemini explicit context cache — static system rules cached per API key + profile. */

import { pooledFetch } from "./pooled-http-client.ts";
import {
  isGeminiCachePayloadClientError,
  isGeminiContextCacheEligible,
  MIN_CACHE_TOKENS,
} from "./gemini-token-estimate.ts";
import { isLlmHttpError, LlmHttpError } from "./llm-http-error.ts";

export type GeminiCacheProfile = "scan" | "cascade";

type CacheRow = { name: string; expiresAtMs: number };

const cacheRows = new Map<string, CacheRow>();
let createInFlight = new Map<string, Promise<string | null>>();

export function readGeminiContextCacheEnabled(): boolean {
  const raw = String(Deno.env.get("GEMINI_CONTEXT_CACHE_ENABLED") ?? "1").trim();
  return raw !== "0" && raw.toLowerCase() !== "false";
}

export function readGeminiContextCacheTtlSec(): number {
  const raw = Number(Deno.env.get("GEMINI_CONTEXT_CACHE_TTL_SEC") ?? "3600");
  if (!Number.isFinite(raw)) return 3600;
  return Math.min(86_400, Math.max(300, Math.floor(raw)));
}

export function readGeminiModelId(): string {
  const m = String(
    Deno.env.get("GEMINI_SCAN_MODEL") ??
      Deno.env.get("GEMINI_MODEL") ??
      "gemini-2.5-flash-lite",
  ).trim();
  return m.startsWith("models/") ? m : `models/${m}`;
}

function slotKey(apiKey: string, profile: GeminiCacheProfile): string {
  return `${apiKey.slice(-12)}:${profile}`;
}

function readValidCache(apiKey: string, profile: GeminiCacheProfile): string | null {
  const row = cacheRows.get(slotKey(apiKey, profile));
  if (!row) return null;
  if (row.expiresAtMs <= Date.now()) {
    cacheRows.delete(slotKey(apiKey, profile));
    return null;
  }
  return row.name;
}

async function createCachedContent(
  apiKey: string,
  systemInstruction: string,
  signal?: AbortSignal,
): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${
      encodeURIComponent(apiKey)
    }`;
  const res = await pooledFetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: readGeminiModelId(),
      systemInstruction: { parts: [{ text: systemInstruction }] },
      ttl: `${readGeminiContextCacheTtlSec()}s`,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 400 && isGeminiCachePayloadClientError(t)) {
      throw new LlmHttpError(
        `Gemini cache create skipped: payload below min tokens (${MIN_CACHE_TOKENS})`,
        400,
        t,
      );
    }
    throw new LlmHttpError(`Gemini cache create ${res.status}: ${t.slice(0, 200)}`, res.status, t);
  }
  const json = await res.json() as { name?: string };
  const name = String(json?.name ?? "").trim();
  if (!name) throw new Error("Gemini cache create missing name");
  return name;
}

/** Resolve cachedContents name — creates/refreshes on miss. */
export async function resolveGeminiCachedContent(
  apiKey: string,
  profile: GeminiCacheProfile,
  systemInstruction: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!readGeminiContextCacheEnabled()) return null;
  if (!isGeminiContextCacheEligible(systemInstruction)) {
    return null;
  }
  const valid = readValidCache(apiKey, profile);
  if (valid) return valid;
  const slot = slotKey(apiKey, profile);
  const inflight = createInFlight.get(slot);
  if (inflight) return inflight;
  const work = (async () => {
    try {
      const name = await createCachedContent(apiKey, systemInstruction, signal);
      const ttlMs = readGeminiContextCacheTtlSec() * 1000;
      cacheRows.set(slot, { name, expiresAtMs: Date.now() + ttlMs - 30_000 });
      console.log(`[gemini_cache] created profile=${profile} name=${name.slice(-24)}`);
      return name;
    } catch (error) {
      if (isLlmHttpError(error) && error.status === 400) {
        return null;
      }
      console.warn(
        `[gemini_cache] create failed profile=${profile}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      createInFlight.delete(slot);
    }
  })();
  createInFlight.set(slot, work);
  return work;
}

export function clearGeminiContextCacheForTests(): void {
  cacheRows.clear();
  createInFlight.clear();
}
