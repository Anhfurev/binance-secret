// @ts-nocheck
/**
 * Persistent HTTP connections for edge cron (Deno `fetch` + `HttpClient` pool).
 * Reuse across Binance gateway, Gemini, Groq, OpenAI, Telegram, etc.
 */

export const HTTP_POOL_KEEP_ALIVE_MS = 60_000;

/** Hosts warmed at module load — extend via `prewarmPooledHttpHost`. */
const DEFAULT_PREWARM_HOSTS = [
  "api.binance.com",
  "generativelanguage.googleapis.com",
  "api.groq.com",
  "api.openai.com",
  "api.telegram.org",
  "api.ipify.org",
] as const;

const httpClients = new Map<string, Deno.HttpClient | null>();

function readExtraPrewarmHosts(): string[] {
  const raw = String(Deno.env.get("HTTP_POOL_PREWARM_HOSTS") ?? "").trim();
  if (!raw) return [];
  return raw.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
}

function resolveHostname(input: string | URL): string {
  const url = input instanceof URL ? input : new URL(input);
  return url.hostname.toLowerCase();
}

function createHttpClientForHost(hostname: string): Deno.HttpClient | null {
  if (!hostname) return null;
  try {
    return Deno.createHttpClient({ pool: { allowHost: hostname } });
  } catch (error) {
    console.warn(
      `[pooled-http] createHttpClient failed host=${hostname}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function getOrCreateHttpClient(hostname: string): Deno.HttpClient | null {
  const host = hostname.toLowerCase();
  if (httpClients.has(host)) return httpClients.get(host) ?? null;
  const client = createHttpClientForHost(host);
  httpClients.set(host, client);
  return client;
}

/** Register a host before the first request (optional cron bootstrap). */
export function prewarmPooledHttpHost(hostname: string): void {
  getOrCreateHttpClient(hostname);
}

export function prewarmDefaultPooledHttpHosts(): void {
  for (const host of DEFAULT_PREWARM_HOSTS) prewarmPooledHttpHost(host);
  for (const host of readExtraPrewarmHosts()) prewarmPooledHttpHost(host);
}

export function readPooledHttpClientCount(): number {
  return [...httpClients.values()].filter(Boolean).length;
}

function withKeepAliveHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers ?? undefined);
  if (!merged.has("Connection")) merged.set("Connection", "keep-alive");
  if (!merged.has("Keep-Alive")) {
    merged.set("Keep-Alive", `timeout=${Math.floor(HTTP_POOL_KEEP_ALIVE_MS / 1000)}`);
  }
  return merged;
}

/**
 * Drop-in `fetch` replacement — reuses `Deno.HttpClient` per host when supported.
 */
export async function pooledFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = input instanceof URL ? input : new URL(input);
  const headers = withKeepAliveHeaders(init.headers);
  const client = getOrCreateHttpClient(url.hostname);
  const requestInit: RequestInit = { ...init, headers };
  if (client) {
    return await fetch(url, { ...requestInit, client });
  }
  return await fetch(url, requestInit);
}

prewarmDefaultPooledHttpHosts();
