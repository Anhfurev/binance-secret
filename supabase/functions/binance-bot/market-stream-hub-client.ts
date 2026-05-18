// @ts-nocheck
import {
  resolveBinanceStreamTickBaseUrl,
  withBinanceGatewayFetchHeaders,
} from "./binance-rest-base.ts";
import { gatewayFetch } from "./gateway-http-client.ts";
import type { StreamMarketPayload } from "./market-stream-payload.ts";

export function isStreamMarketPrefetchEnabled(): boolean {
  const flag = String(Deno.env.get("MARKET_STREAM_PREFETCH_ENABLED") ?? "1").trim();
  return flag !== "0" && flag.toLowerCase() !== "false";
}

function readStreamMarketMaxAgeMs(): number {
  const raw = String(Deno.env.get("MARKET_STREAM_MAX_AGE_MS") ?? "").trim();
  const n = raw.length ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 15_000;
  return Math.min(60_000, Math.max(500, Math.floor(n)));
}

function parseMarketPayload(json: unknown, symbol: string): StreamMarketPayload | null {
  const row = json as Record<string, unknown>;
  if (!row?.ok) return null;
  const updated = Number(row.updated_at_ms ?? 0);
  if (updated > 0 && Date.now() - updated > readStreamMarketMaxAgeMs()) return null;
  const klines = row.klines as StreamMarketPayload["klines"] | undefined;
  if (!klines?.["1m"]?.length) return null;
  return {
    ok: true,
    symbol: String(row.symbol ?? symbol).toUpperCase(),
    updated_at_ms: updated,
    tick: row.tick as StreamMarketPayload["tick"],
    mini: (row.mini as StreamMarketPayload["mini"]) ?? null,
    klines,
  };
}

export async function fetchStreamMarketPayload(
  symbol: string,
  signal?: AbortSignal,
): Promise<StreamMarketPayload | null> {
  if (!isStreamMarketPrefetchEnabled()) return null;
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym || signal?.aborted) return null;
  try {
    const url = new URL(`${resolveBinanceStreamTickBaseUrl()}/stream/market`);
    url.searchParams.set("symbol", sym);
    const res = await gatewayFetch(url, {
      method: "GET",
      cache: "no-store",
      signal,
      headers: withBinanceGatewayFetchHeaders({ Accept: "application/json" }),
    });
    if (!res.ok) return null;
    return parseMarketPayload(await res.json(), sym);
  } catch {
    return null;
  }
}

/** One pooled HTTP round-trip for all symbols (replaces per-symbol REST prefetch). */
export async function fetchStreamMarketsBulk(
  symbols: string[],
  signal?: AbortSignal,
): Promise<Map<string, StreamMarketPayload>> {
  const out = new Map<string, StreamMarketPayload>();
  if (!isStreamMarketPrefetchEnabled() || signal?.aborted) return out;
  const list = [...new Set(symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
  if (!list.length) return out;
  try {
    const url = new URL(`${resolveBinanceStreamTickBaseUrl()}/stream/market/bulk`);
    url.searchParams.set("symbols", list.join(","));
    const res = await gatewayFetch(url, {
      method: "GET",
      cache: "no-store",
      signal,
      headers: withBinanceGatewayFetchHeaders({ Accept: "application/json" }),
    });
    if (!res.ok) return out;
    const json = await res.json() as { markets?: Record<string, unknown> };
    for (const sym of list) {
      const parsed = parseMarketPayload(json.markets?.[sym], sym);
      if (parsed) out.set(sym, parsed);
    }
  } catch {
    /* fallback per-symbol REST */
  }
  return out;
}
