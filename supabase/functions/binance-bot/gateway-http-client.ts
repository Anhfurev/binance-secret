// @ts-nocheck
import {
  withBinanceGatewayFetchHeaders,
} from "./binance-rest-base.ts";
import { mergeAbortSignals, readGatewayFetchTimeoutMs } from "./edge-runtime.ts";
import { pooledFetch, prewarmPooledHttpHost } from "./pooled-http-client.ts";

/** Reuse TCP connections to Binance gateway + api.binance.com via shared pool. */
export async function gatewayFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = input instanceof URL ? input : new URL(input);
  prewarmPooledHttpHost(url.hostname);
  const headers = withBinanceGatewayFetchHeaders(init.headers);
  const timeoutSignal = AbortSignal.timeout(readGatewayFetchTimeoutMs());
  const signal = mergeAbortSignals([init.signal ?? undefined, timeoutSignal]);
  return pooledFetch(url, { ...init, headers, signal });
}
