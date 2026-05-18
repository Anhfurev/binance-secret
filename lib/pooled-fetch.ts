/**
 * Node.js / Next.js persistent HTTP pool (undici — native in Node 18+).
 * Use for Binance REST, LLM providers, and any hot-loop `fetch` calls.
 */

import { Agent, type Dispatcher } from "undici";

export const HTTP_POOL_MAX_SOCKETS = 100;
export const HTTP_POOL_MAX_FREE_SOCKETS = 10;
export const HTTP_POOL_TIMEOUT_MS = 60_000;

export const pooledHttpDispatcher: Dispatcher = new Agent({
  connections: HTTP_POOL_MAX_SOCKETS,
  pipelining: 1,
  keepAliveTimeout: HTTP_POOL_TIMEOUT_MS,
  keepAliveMaxTimeout: HTTP_POOL_TIMEOUT_MS,
  bodyTimeout: HTTP_POOL_TIMEOUT_MS,
  headersTimeout: HTTP_POOL_TIMEOUT_MS,
});

export type PooledFetchInit = RequestInit & {
  dispatcher?: Dispatcher;
};

function withKeepAliveHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers ?? undefined);
  if (!merged.has("Connection")) merged.set("Connection", "keep-alive");
  if (!merged.has("Keep-Alive")) {
    merged.set("Keep-Alive", `timeout=${Math.floor(HTTP_POOL_TIMEOUT_MS / 1000)}`);
  }
  return merged;
}

/** Shared keep-alive `fetch` for outbound REST (Binance, LLM, etc.). */
export function pooledFetch(
  input: string | URL,
  init: PooledFetchInit = {},
): Promise<Response> {
  const headers = withKeepAliveHeaders(init.headers);
  const { dispatcher, ...rest } = init;
  return fetch(input, {
    ...rest,
    headers,
    dispatcher: dispatcher ?? pooledHttpDispatcher,
  } as RequestInit);
}
