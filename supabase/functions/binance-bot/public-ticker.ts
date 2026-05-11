// @ts-nocheck
/** Public Binance spot book ticker (no API keys) for bid/ask–aware paper simulation. */
import { resolveBinanceRestBaseUrl } from "./binance-rest-base.ts";
import { gatewayFetch } from "./gateway-http-client.ts";
import { fetchStreamTickSnapshot } from "./stream-tick-snapshot.ts";
import { toNumber } from "./utils.ts";

export type PublicSpotTicker = {
  bid: number;
  ask: number;
  last: number;
};

function toBinanceRestSymbol(symbol: string): string {
  const u = String(symbol ?? "").trim().toUpperCase();
  if (!u) return "";
  return u.includes("/") ? u.replace("/", "") : u;
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  const n = (e as Error)?.name;
  return n === "AbortError";
}

export async function fetchPublicSpotTicker(
  symbol: string,
  signal?: AbortSignal,
): Promise<PublicSpotTicker | null> {
  if (signal?.aborted) return null;
  try {
    const sym = toBinanceRestSymbol(symbol);
    if (!sym) return null;
    const streamTick = await fetchStreamTickSnapshot(sym, signal);
    if (streamTick) {
      const bid = streamTick.bid > 0 ? streamTick.bid : streamTick.last;
      const ask = streamTick.ask > 0 ? streamTick.ask : streamTick.last;
      const last = streamTick.last > 0 ? streamTick.last : ask;
      if (bid > 0 || ask > 0 || last > 0) {
        return { bid, ask, last };
      }
    }
    const url =
      `${resolveBinanceRestBaseUrl()}/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(sym)}`;
    const res = await gatewayFetch(url, {
      cache: "no-store",
      signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    const bid = toNumber(j.bidPrice ?? j.bid, 0);
    const ask = toNumber(j.askPrice ?? j.ask, 0);
    let last = toNumber(j.lastPrice ?? j.last, 0);
    if (!(last > 0) && bid > 0 && ask > 0) {
      last = Number(((bid + ask) / 2).toFixed(8));
    } else if (!(last > 0) && ask > 0) {
      last = ask;
    } else if (!(last > 0) && bid > 0) {
      last = bid;
    }
    if (!(bid > 0) && !(ask > 0) && !(last > 0)) return null;
    return { bid, ask, last };
  } catch (e) {
    if (signal?.aborted || isAbortError(e)) return null;
    return null;
  }
}
