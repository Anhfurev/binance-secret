// @ts-nocheck
import {
  withBinanceGatewayFetchHeaders,
} from "./binance-rest-base.ts";

const gatewayHttpClients = new Map<string, Deno.HttpClient | null>();

function resolveGatewayHttpClient(hostname: string): Deno.HttpClient | null {
  if (!hostname || hostname === "api.binance.com") return null;
  if (gatewayHttpClients.has(hostname)) {
    return gatewayHttpClients.get(hostname) ?? null;
  }
  try {
    const client = Deno.createHttpClient({ allowHost: hostname });
    gatewayHttpClients.set(hostname, client);
    return client;
  } catch (error) {
    console.warn(
      `[gateway-http] createHttpClient failed for ${hostname}: ${error instanceof Error ? error.message : String(error)}`,
    );
    gatewayHttpClients.set(hostname, null);
    return null;
  }
}

/** Reuse TCP connections to gateway hosts when Deno supports HttpClient pooling. */
export async function gatewayFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = input instanceof URL ? input : new URL(input);
  const headers = withBinanceGatewayFetchHeaders(init.headers);
  const client = resolveGatewayHttpClient(url.hostname);
  const requestInit: RequestInit = { ...init, headers };
  if (client) {
    return await fetch(url, { ...requestInit, client });
  }
  return await fetch(url, requestInit);
}
