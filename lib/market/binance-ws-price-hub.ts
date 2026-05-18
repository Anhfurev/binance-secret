/**
 * Shared Binance aggTrade WebSocket per symbol — ref-counted for multi-card views.
 */

import { normalizeTradingSymbol } from "./symbol.ts";
import { setLivePriceInCache } from "./live-price-cache.ts";

type StreamHandle = {
  ws: WebSocket | null;
  refs: number;
  connecting: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

const streams = new Map<string, StreamHandle>();

function readWsBaseUrl(): string {
  const custom = (process.env.NEXT_PUBLIC_BINANCE_WS_BASE ?? "").trim();
  if (custom) return custom.replace(/\/$/, "");
  return "wss://stream.binance.com:9443/ws";
}

function streamUrl(symbol: string): string {
  const sym = normalizeTradingSymbol(symbol).toLowerCase();
  const base = readWsBaseUrl();
  if (base.includes("@")) return base;
  return `${base}/${sym}@aggTrade`;
}

function parseAggTradePrice(payload: MessageEvent["data"]): number | null {
  try {
    const raw = typeof payload === "string" ? payload : "";
    const msg = JSON.parse(raw) as { p?: string; data?: { p?: string } };
    const p = msg?.p ?? msg?.data?.p;
    const px = Number(p);
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    return null;
  }
}

function connectStream(symbol: string): void {
  const sym = normalizeTradingSymbol(symbol);
  if (!sym || typeof WebSocket === "undefined") return;
  const handle = streams.get(sym);
  if (!handle || handle.ws || handle.connecting) return;

  handle.connecting = true;
  const ws = new WebSocket(streamUrl(sym));

  ws.onopen = () => {
    handle.connecting = false;
    handle.ws = ws;
  };

  ws.onmessage = (event) => {
    const px = parseAggTradePrice(event.data);
    if (px != null) setLivePriceInCache(sym, px, "ws");
  };

  ws.onerror = () => {
    handle.connecting = false;
  };

  ws.onclose = () => {
    handle.ws = null;
    handle.connecting = false;
    if (handle.refs <= 0) return;
    if (handle.reconnectTimer) clearTimeout(handle.reconnectTimer);
    handle.reconnectTimer = setTimeout(() => {
      handle.reconnectTimer = null;
      if (handle.refs > 0) connectStream(sym);
    }, 2000);
  };

  handle.ws = ws;
}

function teardownStream(symbol: string): void {
  const sym = normalizeTradingSymbol(symbol);
  const handle = streams.get(sym);
  if (!handle) return;
  if (handle.reconnectTimer) clearTimeout(handle.reconnectTimer);
  handle.ws?.close();
  streams.delete(sym);
}

/** Subscribe symbol to Binance WS; returns release fn. */
export function acquireBinancePriceStream(symbol: string): () => void {
  const sym = normalizeTradingSymbol(symbol);
  if (!sym) return () => undefined;

  let handle = streams.get(sym);
  if (!handle) {
    handle = { ws: null, refs: 0, connecting: false, reconnectTimer: null };
    streams.set(sym, handle);
  }
  handle.refs += 1;
  connectStream(sym);

  return () => {
    const row = streams.get(sym);
    if (!row) return;
    row.refs = Math.max(0, row.refs - 1);
    if (row.refs === 0) teardownStream(sym);
  };
}

export function isBinancePriceStreamActive(symbol: string): boolean {
  const sym = normalizeTradingSymbol(symbol);
  const handle = streams.get(sym);
  return Boolean(handle && (handle.ws?.readyState === WebSocket.OPEN || handle.connecting));
}
