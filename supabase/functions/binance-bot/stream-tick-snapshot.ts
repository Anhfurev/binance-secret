// @ts-nocheck
import {
  resolveBinanceRestBaseUrl,
  withBinanceGatewayFetchHeaders,
} from "./binance-rest-base.ts";
import { gatewayFetch } from "./gateway-http-client.ts";
import { toNumber } from "./utils.ts";

export type StreamTickSnapshot = {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  ageMs: number;
  source: "websocket";
};

function readStreamTickMaxAgeMs(): number {
  const raw = String(Deno.env.get("BINANCE_STREAM_TICK_MAX_AGE_MS") ?? "").trim();
  const n = raw.length ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 2500;
  return Math.min(15_000, Math.max(250, Math.floor(n)));
}

export function isStreamTickEnabled(): boolean {
  const flag = String(Deno.env.get("BINANCE_STREAM_TICK_ENABLED") ?? "1").trim();
  return flag !== "0" && flag.toLowerCase() !== "false";
}

export function parseStreamTickResponse(
  json: unknown,
  symbol: string,
): StreamTickSnapshot | null {
  const row = json as Record<string, unknown>;
  if (!row || row.ok === false) return null;
  const last = toNumber(row.last, 0);
  const bid = toNumber(row.bid, 0);
  const ask = toNumber(row.ask, 0);
  if (!(last > 0) && !(bid > 0) && !(ask > 0)) return null;
  const ageMs = Math.max(0, Math.floor(toNumber(row.age_ms, 0)));
  return {
    symbol: String(row.symbol ?? symbol).toUpperCase(),
    last: last > 0 ? last : ask > 0 && bid > 0
      ? Number(((bid + ask) / 2).toFixed(12))
      : ask > 0
      ? ask
      : bid,
    bid,
    ask,
    ageMs,
    source: "websocket",
  };
}

export async function fetchStreamTickSnapshot(
  symbol: string,
  signal?: AbortSignal,
): Promise<StreamTickSnapshot | null> {
  if (!isStreamTickEnabled()) return null;
  if (signal?.aborted) return null;
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return null;
  try {
    const url = new URL(`${resolveBinanceRestBaseUrl()}/stream/tick`);
    url.searchParams.set("symbol", sym);
    const response = await gatewayFetch(url, {
      method: "GET",
      cache: "no-store",
      signal,
      headers: withBinanceGatewayFetchHeaders({ Accept: "application/json" }),
    });
    if (!response.ok) return null;
    const parsed = parseStreamTickResponse(await response.json(), sym);
    if (!parsed) return null;
    if (parsed.ageMs > readStreamTickMaxAgeMs()) return null;
    return parsed;
  } catch {
    return null;
  }
}
