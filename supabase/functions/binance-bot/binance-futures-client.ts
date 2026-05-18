// @ts-nocheck
/** Binance USDT-M futures REST (`fapi.binance.com`) — market entry + protective brackets. */

import { getCachedTimeOffset } from "./binance-time-cache.ts";
import { pooledFetch } from "./pooled-http-client.ts";
import type { BotGlobalSettingsRow } from "./bot-global-settings.ts";
import { isPaperTradingEnvForced } from "./paper-trade-interceptor.ts";
import {
  computeFastLaneFuturesQty,
  computeFastLaneNotionalUsd,
  toFuturesUsdtSymbol,
} from "./futures-lane-sizing.ts";

export {
  computeFastLaneNotionalUsd,
  BTC_FUTURES_MIN_NOTIONAL_USD,
  ALT_FUTURES_MIN_NOTIONAL_USD,
} from "./futures-lane-sizing.ts";

const FAPI_BASE = "https://fapi.binance.com";

export type FuturesBracketResult = {
  entryOrderId: string;
  stopOrderId: string | null;
  takeProfitOrderId: string | null;
  entryPrice: number;
  quantity: number;
  notionalUsd: number;
  leverage: number;
};

function readApiCreds(): { apiKey: string; secret: string } {
  const apiKey = (Deno.env.get("BINANCE_API_KEY") ?? "").trim();
  const secret = (Deno.env.get("BINANCE_SECRET") ?? Deno.env.get("BINANCE_API_SECRET") ?? "").trim();
  if (!apiKey || !secret) throw new Error("Missing BINANCE_API_KEY or BINANCE_SECRET for futures");
  return { apiKey, secret };
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fapiSignedRequest(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string | number>,
): Promise<unknown> {
  const { apiKey, secret } = readApiCreds();
  const timestamp = Date.now() + getCachedTimeOffset();
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.set(k, String(v));
  body.set("timestamp", String(timestamp));
  body.set("recvWindow", "60000");
  const query = body.toString();
  const signature = await hmacSha256Hex(secret, query);
  const url = `${FAPI_BASE}${path}?${query}&signature=${signature}`;
  const res = await pooledFetch(url, {
    method,
    headers: { "X-MBX-APIKEY": apiKey, "Content-Type": "application/x-www-form-urlencoded" },
  });
  const text = await res.text().catch(() => "");
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`FAPI ${method} ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

function toFapiSymbol(symbol: string): string {
  return toFuturesUsdtSymbol(symbol);
}

export async function setFuturesLeverage(symbol: string, leverage: number): Promise<void> {
  await fapiSignedRequest("POST", "/fapi/v1/leverage", {
    symbol: toFapiSymbol(symbol),
    leverage: Math.min(50, Math.max(1, Math.floor(leverage))),
  });
}

export async function executeFuturesBounceBrackets(params: {
  symbol: string;
  global: BotGlobalSettingsRow;
  referencePrice: number;
  stopPct?: number;
  takeProfitPct?: number;
}): Promise<FuturesBracketResult> {
  const sym = toFapiSymbol(params.symbol);
  const px = Number(params.referencePrice);
  if (!Number.isFinite(px) || px <= 0) throw new Error("futures_bounce: invalid referencePrice");

  const leverage = Math.min(50, Math.max(1, Math.floor(params.global.allowed_leverage ?? 10)));
  const notionalUsd = computeFastLaneNotionalUsd(sym, params.global);
  const qty = computeFastLaneFuturesQty(sym, notionalUsd, px);
  if (qty <= 0) throw new Error("futures_bounce: quantity zero");

  if (isPaperTradingEnvForced()) {
    const entryPrice = px;
    return {
      entryOrderId: `paper-fut-${Date.now()}`,
      stopOrderId: null,
      takeProfitOrderId: null,
      entryPrice,
      quantity: qty,
      notionalUsd,
      leverage,
    };
  }

  await setFuturesLeverage(sym, leverage);

  const entry = await fapiSignedRequest("POST", "/fapi/v1/order", {
    symbol: sym,
    side: "BUY",
    type: "MARKET",
    quantity: qty,
  }) as { orderId?: number; avgPrice?: string; price?: string };

  const entryPrice = Number(entry?.avgPrice ?? entry?.price ?? px) || px;
  const stopPct = params.stopPct ?? 0.01;
  const tpPct = params.takeProfitPct ?? 0.02;
  const stopPrice = Number((entryPrice * (1 - stopPct)).toFixed(8));
  const takeProfitPrice = Number((entryPrice * (1 + tpPct)).toFixed(8));

  const stop = await fapiSignedRequest("POST", "/fapi/v1/order", {
    symbol: sym,
    side: "SELL",
    type: "STOP_MARKET",
    stopPrice,
    closePosition: "true",
    workingType: "MARKET_PRICE",
  }) as { orderId?: number };

  const tp = await fapiSignedRequest("POST", "/fapi/v1/order", {
    symbol: sym,
    side: "SELL",
    type: "TAKE_PROFIT",
    stopPrice: takeProfitPrice,
    price: takeProfitPrice,
    quantity: qty,
    timeInForce: "GTC",
    workingType: "CONTRACT_PRICE",
  }) as { orderId?: number };

  return {
    entryOrderId: String(entry?.orderId ?? ""),
    stopOrderId: stop?.orderId != null ? String(stop.orderId) : null,
    takeProfitOrderId: tp?.orderId != null ? String(tp.orderId) : null,
    entryPrice,
    quantity: qty,
    notionalUsd,
    leverage,
  };
}
