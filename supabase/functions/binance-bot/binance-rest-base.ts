// @ts-nocheck
import { BINANCE_BASE_URL } from "./constants.ts";

function readGatewayUrl(): string {
  return (
    (Deno.env.get("BINANCE_REST_GATEWAY_URL") ?? "").trim() ||
    (Deno.env.get("BINANCE_API_GATEWAY_URL") ?? "").trim()
  );
}

function readStreamTickGatewayUrl(): string {
  return (
    (Deno.env.get("BINANCE_STREAM_TICK_GATEWAY_URL") ?? "").trim() ||
    (Deno.env.get("BINANCE_STREAM_GATEWAY_URL") ?? "").trim() ||
    readGatewayUrl()
  );
}

export function resolveBinanceRestBaseUrl(): string {
  const gateway = readGatewayUrl();
  if (!gateway) return BINANCE_BASE_URL;
  return gateway.replace(/\/+$/, "");
}

/** Stream hub `/stream/tick` may live on the REST gateway or a dedicated tick base URL. */
export function resolveBinanceStreamTickBaseUrl(): string {
  const gateway = readStreamTickGatewayUrl();
  if (!gateway) return BINANCE_BASE_URL;
  return gateway.replace(/\/+$/, "");
}

export function isBinanceRestGatewayEnabled(): boolean {
  return readGatewayUrl().length > 0;
}

export function shouldSkipEgressIpCheck(): boolean {
  return isBinanceRestGatewayEnabled();
}

export function resolveBinanceGatewayHeaders(): Record<string, string> {
  const secret = (Deno.env.get("BINANCE_GATEWAY_SECRET") ?? "").trim();
  if (!secret) return {};
  return { "X-Binance-Gateway-Secret": secret };
}

export function withBinanceGatewayFetchHeaders(
  headers?: HeadersInit,
): Headers {
  const merged = new Headers(headers ?? undefined);
  for (const [key, value] of Object.entries(resolveBinanceGatewayHeaders())) {
    merged.set(key, value);
  }
  return merged;
}

export function ccxtBinanceOptionsForRestGateway(): Record<string, unknown> {
  const base = resolveBinanceRestBaseUrl();
  if (base === BINANCE_BASE_URL) return {};
  return {
    urls: {
      api: {
        public: `${base}/api/v3`,
        private: `${base}/api/v3`,
        v1: `${base}/api/v1`,
        sapi: `${base}/sapi/v1`,
      },
    },
    headers: resolveBinanceGatewayHeaders(),
  };
}
