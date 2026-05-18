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

/** Safe Headers merge — never throws on null/invalid cron background init. */
function withKeepAliveHeaders(headers?: HeadersInit): Headers {
  if (headers == null) {
    return new Headers();
  }
  try {
    return new Headers(headers);
  } catch {
    if (typeof headers === "object" && !Array.isArray(headers)) {
      try {
        return new Headers(headers as Record<string, string>);
      } catch {
        return new Headers();
      }
    }
    return new Headers();
  }
}

/** Shared keep-alive `fetch` for outbound REST (Binance, LLM, etc.). */
export function pooledFetch(
  input: string | URL,
  init?: PooledFetchInit,
): Promise<Response> {
  // Bulletproof fallback for automated cron / background threads
  const incomingHeaders = init?.headers ? init.headers : {};
  const headers = withKeepAliveHeaders(incomingHeaders);

  const { dispatcher, ...rest } = init ?? {};
  // Do not set Connection / Keep-Alive — undici manages pooling via `dispatcher`
  // and rejects malformed Keep-Alive values (UND_ERR_INVALID_ARG).
  return fetch(input, {
    ...rest,
    headers,
    dispatcher: dispatcher ?? pooledHttpDispatcher,
  } as RequestInit);
}
