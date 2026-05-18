// @ts-nocheck
/** Route CCXT REST through the shared Deno HTTP connection pool. */

import type ccxt from "ccxt";
import { pooledFetch } from "./pooled-http-client.ts";

type CcxtExchange = InstanceType<typeof ccxt.binance>;

export function bindCcxtPooledFetch(exchange: CcxtExchange): CcxtExchange {
  exchange.fetchImplementation = async (
    url: string,
    params: Record<string, unknown> = {},
  ) => {
    const method = String(params.method ?? "GET");
    const headers = params.headers as HeadersInit | undefined;
    const body = params.body as BodyInit | null | undefined;
    const signal = params.signal as AbortSignal | undefined;
    return pooledFetch(url, { method, headers, body: body ?? undefined, signal });
  };
  return exchange;
}
