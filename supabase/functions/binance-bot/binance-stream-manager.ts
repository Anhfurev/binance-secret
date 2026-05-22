// @ts-nocheck
/**
 * Native Deno WebSocket combined-stream manager for Binance spot market data.
 * Self-healing reconnect, stale detection, proactive 24h rotation.
 */

import { edgeWaitUntil } from "./edge-runtime.ts";
import {
  patchWsAggTrade,
  patchWsBookTicker,
  patchWsMiniTicker,
  refreshWsMarketCacheEntry,
} from "./market-cache-ws.ts";
import { applyWsKlineEvent } from "./ws-kline-store.ts";

const WS_BASE = "wss://stream.binance.com:9443/stream?streams=";
const STALE_CHECK_MS = 30_000;
const STALE_CLOSE_MS = 10 * 60_000;
const MAX_RECONNECT_MS = 30_000;
const WS_ROTATE_BEFORE_MS = 23 * 60 * 60_000 + 50 * 60_000;

let managerStarted = false;
let reconnectDelayMs = 1000;
let activeSocket: WebSocket | null = null;
let watchSymbols = new Set<string>();
let watchSymbolsFingerprint = "";
let lastMessageAtMs = 0;
let connectedAtMs = 0;
let staleTimer: ReturnType<typeof setInterval> | null = null;

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function isNativeBinanceWsMarketCacheEnabled(): boolean {
  const flag = String(Deno.env.get("BINANCE_WS_MARKET_CACHE") ?? "1").trim();
  return flag !== "0" && flag.toLowerCase() !== "false";
}

export function readDefaultStreamSymbols(): string[] {
  const raw = String(
    Deno.env.get("STREAM_SYMBOLS") ??
      Deno.env.get("BOT_SYMBOLS") ??
      "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,PEPEUSDT,DOGEUSDT,XRPUSDT,ADAUSDT,LINKUSDT,AVAXUSDT",
  ).trim();
  return [...new Set(raw.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
}

function watchSymbolsKey(): string {
  return [...watchSymbols].sort().join(",");
}

function requestWsReconnect(reason: string): void {
  const ws = activeSocket;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  console.log(`[ws-manager] reconnect requested: ${reason}`);
  try {
    ws.close(1000, reason.slice(0, 120));
  } catch {
    /* closing */
  }
}

function mergeWatchSymbols(symbols: string[]): string[] {
  for (const s of symbols) {
    const sym = String(s).trim().toUpperCase();
    if (sym) watchSymbols.add(sym);
  }
  if (!watchSymbols.size) {
    for (const s of readDefaultStreamSymbols()) watchSymbols.add(s);
  }
  const nextKey = watchSymbolsKey();
  if (managerStarted && nextKey !== watchSymbolsFingerprint) {
    watchSymbolsFingerprint = nextKey;
    requestWsReconnect("symbol_set_changed");
  } else {
    watchSymbolsFingerprint = nextKey;
  }
  return [...watchSymbols];
}

function buildCombinedStreamUrl(symbols: string[]): string {
  const streams: string[] = [];
  for (const symbol of symbols) {
    const s = symbol.toLowerCase();
    streams.push(
      `${s}@ticker`,
      `${s}@bookTicker`,
      `${s}@aggTrade`,
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

function clearTimers(): void {
  if (staleTimer) clearInterval(staleTimer);
  staleTimer = null;
}

function armTimers(ws: WebSocket): void {
  clearTimers();
  staleTimer = setInterval(() => {
    const idle = Date.now() - lastMessageAtMs;
    if (idle > STALE_CLOSE_MS) {
      console.warn(`[ws-manager] stale ${Math.round(idle / 1000)}s — reconnecting`);
      try {
        ws.close(4000, "stale");
      } catch {
        /* ignore */
      }
    }
    if (connectedAtMs > 0 && Date.now() - connectedAtMs >= WS_ROTATE_BEFORE_MS) {
      console.log("[WS RESET] 24h Binance stream rotation — opening fresh socket");
      try {
        ws.close(1000, "24h_rotation");
      } catch {
        /* ignore */
      }
    }
  }, STALE_CHECK_MS);
}

function handleBinancePayload(payload: Record<string, unknown>): void {
  lastMessageAtMs = Date.now();
  const event = String(payload.e ?? "");
  const symbol = String(payload.s ?? "").toUpperCase();
  if (!symbol) return;

  if (event === "aggTrade") {
    patchWsAggTrade(symbol, toNum(payload.p), toNum(payload.E) || Date.now());
    return;
  }

  if (event === "bookTicker") {
    patchWsBookTicker(symbol, toNum(payload.b), toNum(payload.a), Date.now());
    return;
  }

  if (event === "24hrTicker") {
    patchWsMiniTicker(symbol, {
      last: toNum(payload.c),
      high: toNum(payload.h),
      low: toNum(payload.l),
      quoteVolume: toNum(payload.q),
      baseVolume: toNum(payload.v),
    });
    return;
  }

  if (event === "kline") {
    const k = payload.k as Record<string, unknown> | undefined;
    if (!k) return;
    const interval = String(k.i ?? "");
    if (!interval) return;
    applyWsKlineEvent(symbol, interval, k);
    refreshWsMarketCacheEntry(symbol);
  }
}

function parseWsMessage(raw: string): void {
  const parsed = JSON.parse(raw) as {
    stream?: string;
    data?: Record<string, unknown>;
  };
  const payload = parsed.data ?? (parsed as Record<string, unknown>);
  if (payload && typeof payload === "object") handleBinancePayload(payload);
}

async function runOneConnection(symbols: string[]): Promise<void> {
  const url = buildCombinedStreamUrl(symbols);
  console.log(`[ws-manager] connect symbols=${symbols.join(",")}`);
  const ws = new WebSocket(url);
  activeSocket = ws;

  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimers();
      resolve();
    };

    ws.onopen = () => {
      lastMessageAtMs = Date.now();
      connectedAtMs = Date.now();
      reconnectDelayMs = 1000;
      armTimers(ws);
      console.log("[ws-manager] open");
    };

    ws.onmessage = (ev) => {
      try {
        parseWsMessage(String(ev.data ?? ""));
      } catch (error) {
        console.warn(
          `[ws-manager] parse: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    ws.onerror = () => {
      console.warn("[ws-manager] error — will reconnect");
      finish();
    };

    ws.onclose = (ev) => {
      const uptime = connectedAtMs ? Math.round((Date.now() - connectedAtMs) / 1000) : 0;
      if (ev.code === 1000 && ev.reason === "24h_rotation") {
        console.log(`[WS RESET] closed cleanly uptime_s=${uptime}`);
      } else {
        console.warn(`[ws-manager] close code=${ev.code} reason=${ev.reason || "—"} uptime_s=${uptime}`);
      }
      finish();
    };
  });

  activeSocket = null;
}

async function managerLoop(): Promise<void> {
  while (true) {
    const symbols = mergeWatchSymbols([]);
    try {
      await runOneConnection(symbols);
    } catch (error) {
      console.warn(
        `[ws-manager] loop: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const delay = reconnectDelayMs;
    reconnectDelayMs = Math.min(MAX_RECONNECT_MS, reconnectDelayMs * 2);
    await new Promise((r) => setTimeout(r, delay));
  }
}

/** Start background combined stream (idempotent). */
export function ensureBinanceStreamManager(symbols: string[] = []): void {
  if (!isNativeBinanceWsMarketCacheEnabled()) return;
  mergeWatchSymbols(symbols);
  if (managerStarted) return;
  managerStarted = true;
  edgeWaitUntil(
    managerLoop().catch((err) => {
      console.error(
        "[ws-manager] fatal:",
        err instanceof Error ? err.message : String(err),
      );
      managerStarted = false;
    }),
  );
}

export function readWsManagerStats(): {
  symbols: number;
  connected: boolean;
  lastMessageAgeMs: number;
  uptimeMs: number;
} {
  return {
    symbols: watchSymbols.size,
    connected: activeSocket?.readyState === WebSocket.OPEN,
    lastMessageAgeMs: lastMessageAtMs ? Date.now() - lastMessageAtMs : -1,
    uptimeMs: connectedAtMs ? Date.now() - connectedAtMs : 0,
  };
}
