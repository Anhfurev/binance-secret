// @ts-nocheck
/**
 * Persistent Binance combined-stream WebSocket (npm `ws`).
 * Streams: bookTicker, aggTrade, miniTicker, kline_1m/15m/1h/4h/1d.
 */
import WebSocket from "npm:ws@8.18.0";
import { readSymbols } from "./config.ts";
import { applyKlineWsEvent } from "./kline-store.ts";
import { refreshMarketCacheEntry, patchMiniTicker } from "./market-cache.ts";
import { updateAggTrade, updateBookTicker } from "./symbol-store.ts";
import { maybeWakeBotOnWick } from "./wick-wake.ts";

const WS_BASE = "wss://stream.binance.com:9443/stream?streams=";
const PING_INTERVAL_MS = 3 * 60_000;
const STALE_CLOSE_MS = 10 * 60_000;

let reconnectDelayMs = 1000;
let socket: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let staleTimer: ReturnType<typeof setInterval> | null = null;
let lastMessageAtMs = Date.now();

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildStreamUrl(symbols: string[]): string {
  const streams: string[] = [];
  for (const symbol of symbols) {
    const s = symbol.toLowerCase();
    streams.push(
      `${s}@bookTicker`,
      `${s}@aggTrade`,
      `${s}@miniTicker`,
      `${s}@kline_1m`,
      `${s}@kline_5m`,
      `${s}@kline_15m`,
      `${s}@kline_1h`,
      `${s}@kline_4h`,
      `${s}@kline_1d`,
    );
  }
  return `${WS_BASE}${streams.join("/")}`;
}

function handlePayload(payload: Record<string, unknown>) {
  lastMessageAtMs = Date.now();
  const event = String(payload.e ?? "");
  const symbol = String(payload.s ?? "").toUpperCase();
  if (!symbol) return;

  if (event === "aggTrade") {
    const price = toNumber(payload.p);
    const ts = toNumber(payload.E) || Date.now();
    updateAggTrade(symbol, price, ts);
    void maybeWakeBotOnWick(symbol, price, ts);
    refreshMarketCacheEntry(symbol);
    return;
  }

  if (event === "bookTicker") {
    updateBookTicker(
      symbol,
      toNumber(payload.b),
      toNumber(payload.a),
      Date.now(),
    );
    refreshMarketCacheEntry(symbol);
    return;
  }

  if (event === "24hrMiniTicker") {
    patchMiniTicker(symbol, {
      last: toNumber(payload.c),
      high: toNumber(payload.h),
      low: toNumber(payload.l),
      quoteVolume: toNumber(payload.q),
      baseVolume: toNumber(payload.v),
    });
    return;
  }

  if (event === "kline") {
    const k = payload.k as Record<string, unknown> | undefined;
    if (!k) return;
    const interval = String(k.i ?? "");
    if (!interval) return;
    applyKlineWsEvent(symbol, interval, k);
    refreshMarketCacheEntry(symbol);
  }
}

function clearTimers() {
  if (pingTimer) clearInterval(pingTimer);
  if (staleTimer) clearInterval(staleTimer);
  pingTimer = null;
  staleTimer = null;
}

function armTimers() {
  clearTimers();
  pingTimer = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.ping();
  }, PING_INTERVAL_MS);
  staleTimer = setInterval(() => {
    if (Date.now() - lastMessageAtMs > STALE_CLOSE_MS) {
      console.warn("[ws-manager] stale socket — forcing reconnect");
      socket?.terminate();
    }
  }, 30_000);
}

function attachSocket(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.on("open", () => {
      lastMessageAtMs = Date.now();
      reconnectDelayMs = 1000;
      armTimers();
      console.log("[ws-manager] connected");
    });
    ws.on("ping", () => ws.pong());
    ws.on("message", (raw) => {
      try {
        const parsed = JSON.parse(String(raw)) as {
          stream?: string;
          data?: Record<string, unknown>;
        };
        const payload = parsed.data ?? (parsed as Record<string, unknown>);
        if (payload && typeof payload === "object") handlePayload(payload);
      } catch (error) {
        console.warn(
          `[ws-manager] parse error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    ws.on("close", () => {
      clearTimers();
      resolve();
    });
    ws.on("error", () => {
      clearTimers();
      resolve();
    });
  });
}

export async function runBinanceWsManager(): Promise<never> {
  const symbols = readSymbols();
  while (true) {
    const url = buildStreamUrl(symbols);
    console.log(`[ws-manager] connecting symbols=${symbols.join(",")}`);
    try {
      socket = new WebSocket(url);
      await attachSocket(socket);
    } catch (error) {
      console.warn(
        `[ws-manager] disconnect: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    socket = null;
    await new Promise((r) => setTimeout(r, reconnectDelayMs));
    reconnectDelayMs = Math.min(30_000, reconnectDelayMs * 2);
  }
}
