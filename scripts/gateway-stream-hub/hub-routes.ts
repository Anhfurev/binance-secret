import { readGatewaySecret } from "./config.ts";
import { getMarketCacheEntry, marketCache } from "./market-cache.ts";
import { getTick } from "./symbol-store.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function isAuthorized(req: Request): boolean {
  const expected = readGatewaySecret();
  if (!expected) return true;
  const provided = (req.headers.get("x-binance-gateway-secret") ?? "").trim();
  return provided === expected;
}

function handleTick(symbol: string): Response {
  const tick = getTick(symbol);
  if (!tick) {
    return jsonResponse({ ok: false, error: "tick_unavailable", symbol }, 404);
  }
  const now = Date.now();
  const ageMs = Math.max(0, now - Math.max(tick.lastTradeTs, tick.bookTickerTs));
  return jsonResponse({
    ok: true,
    source: "websocket",
    symbol: tick.symbol,
    last: tick.last,
    bid: tick.bid,
    ask: tick.ask,
    last_trade_ts: tick.lastTradeTs,
    book_ticker_ts: tick.bookTickerTs,
    age_ms: ageMs,
  });
}

function handleMarketPayload(symbol: string): Response {
  const entry = getMarketCacheEntry(symbol);
  if (!entry) {
    return jsonResponse({ ok: false, error: "market_not_ready", symbol }, 404);
  }
  return jsonResponse({
    ok: true,
    source: "websocket_cache",
    symbol: entry.symbol,
    updated_at_ms: entry.updatedAtMs,
    tick: entry.tick,
    mini: entry.mini,
    klines: {
      "1m": entry.klines1m,
      "5m": entry.klines5m,
      "15m": entry.klines15m,
      "1h": entry.klines1h,
      "4h": entry.klines4h,
      "1d": entry.klines1d,
    },
  });
}

function handleBulk(symbolsParam: string): Response {
  const symbols = symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const out: Record<string, unknown> = {};
  for (const sym of symbols) {
    const entry = getMarketCacheEntry(sym);
    if (!entry) {
      out[sym] = { ok: false, error: "market_not_ready" };
      continue;
    }
    out[sym] = {
      ok: true,
      symbol: entry.symbol,
      updated_at_ms: entry.updatedAtMs,
      tick: entry.tick,
      mini: entry.mini,
      klines: {
        "1m": entry.klines1m,
        "5m": entry.klines5m,
        "15m": entry.klines15m,
        "1h": entry.klines1h,
        "4h": entry.klines4h,
        "1d": entry.klines1d,
      },
    };
  }
  return jsonResponse({ ok: true, markets: out, ready: Object.keys(marketCache).length });
}

export function handleHubRequest(req: Request): Response {
  if (!isAuthorized(req)) {
    return jsonResponse({ ok: false, error: "forbidden" }, 403);
  }
  const url = new URL(req.url);
  if (url.pathname === "/healthz") {
    return new Response("ok\n", { status: 200 });
  }
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (
    (url.pathname === "/tick" || url.pathname === "/stream/tick") &&
    req.method === "GET"
  ) {
    if (!symbol) return jsonResponse({ ok: false, error: "missing_symbol" }, 400);
    return handleTick(symbol);
  }
  if (
    (url.pathname === "/stream/market" || url.pathname === "/market") &&
    req.method === "GET"
  ) {
    if (!symbol) return jsonResponse({ ok: false, error: "missing_symbol" }, 400);
    return handleMarketPayload(symbol);
  }
  if (url.pathname === "/stream/market/bulk" && req.method === "GET") {
    const list = url.searchParams.get("symbols") ?? "";
    if (!list.trim()) return jsonResponse({ ok: false, error: "missing_symbols" }, 400);
    return handleBulk(list);
  }
  return jsonResponse({ ok: false, error: "not_found" }, 404);
}
