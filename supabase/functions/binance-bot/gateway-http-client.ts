// @ts-nocheck
import {
  isBinanceRestGatewayEnabled,
  resolveBinanceRestBaseUrl,
  withBinanceGatewayFetchHeaders,
} from "./binance-rest-base.ts";

let gatewayHttpClient: Deno.HttpClient | null | undefined;

function resolveGatewayHttpClient(): Deno.HttpClient | null {
  if (!isBinanceRestGatewayEnabled()) return null;
  if (gatewayHttpClient !== undefined) return gatewayHttpClient;
  try {
    const host = new URL(resolveBinanceRestBaseUrl()).hostname;
    gatewayHttpClient = Deno.createHttpClient({ allowHost: host });
  } catch (error) {
    console.warn(
      `[gateway-http] createHttpClient failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    gatewayHttpClient = null;
  }
  return gatewayHttpClient;
}

/** Reuse TCP connections to the Binance REST gateway when Deno supports HttpClient pooling. */
export async function gatewayFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = withBinanceGatewayFetchHeaders(init.headers);
  const client = resolveGatewayHttpClient();
  const requestInit: RequestInit = { ...init, headers };
  if (client) {
    return await fetch(input, { ...requestInit, client });
  }
  return await fetch(input, requestInit);
}
