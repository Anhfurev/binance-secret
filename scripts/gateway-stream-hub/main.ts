import { readGatewaySecret, readListenPort } from "./config.ts";
import { getTick } from "./symbol-store.ts";
import { runBinanceStreamClient } from "./ws-client.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isAuthorized(req: Request): boolean {
  const expected = readGatewaySecret();
  if (!expected) return true;
  const provided = (req.headers.get("x-binance-gateway-secret") ?? "").trim();
  return provided === expected;
}

function handleTick(req: Request): Response {
  if (!isAuthorized(req)) {
    return jsonResponse({ ok: false, error: "forbidden" }, 403);
  }
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol) {
    return jsonResponse({ ok: false, error: "missing_symbol" }, 400);
  }
  const tick = getTick(symbol);
  if (!tick) {
    return jsonResponse({ ok: false, error: "tick_unavailable", symbol }, 404);
  }
  const now = Date.now();
  const ageMs = Math.max(
    0,
    now - Math.max(tick.lastTradeTs, tick.bookTickerTs),
  );
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

function handleRequest(req: Request): Response {
  const url = new URL(req.url);
  if (url.pathname === "/healthz") {
    return new Response("ok\n", { status: 200 });
  }
  if (url.pathname === "/tick" && req.method === "GET") {
    return handleTick(req);
  }
  return jsonResponse({ ok: false, error: "not_found" }, 404);
}

const port = readListenPort();
Deno.serve({ port, hostname: "127.0.0.1" }, handleRequest);
void runBinanceStreamClient();
