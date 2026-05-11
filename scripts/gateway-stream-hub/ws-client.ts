import { readSymbols } from "./config.ts";
import { updateAggTrade, updateBookTicker } from "./symbol-store.ts";
import { maybeWakeBotOnWick } from "./wick-wake.ts";

const WS_BASE = "wss://stream.binance.com:9443/stream?streams=";
let reconnectDelayMs = 1000;

function buildStreamUrl(symbols: string[]): string {
  const streams: string[] = [];
  for (const symbol of symbols) {
    const s = symbol.toLowerCase();
    streams.push(`${s}@aggTrade`, `${s}@bookTicker`);
  }
  return `${WS_BASE}${streams.join("/")}`;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function handlePayload(payload: Record<string, unknown>) {
  const event = String(payload.e ?? "");
  const symbol = String(payload.s ?? "").toUpperCase();
  if (!symbol) return;

  if (event === "aggTrade") {
    const price = toNumber(payload.p);
    const ts = toNumber(payload.E) || Date.now();
    updateAggTrade(symbol, price, ts);
    void maybeWakeBotOnWick(symbol, price, ts);
    return;
  }

  const bid = toNumber(payload.b);
  const ask = toNumber(payload.a);
  if (bid > 0 || ask > 0) {
    updateBookTicker(symbol, bid, ask, Date.now());
  }
}

function consumeSocket(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as {
          stream?: string;
          data?: Record<string, unknown>;
        };
        const payload = parsed.data ?? (parsed as Record<string, unknown>);
        if (payload && typeof payload === "object") {
          handlePayload(payload);
        }
      } catch (error) {
        console.warn(
          `[ws-client] parse error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    socket.onclose = () => resolve();
    socket.onerror = () => resolve();
  });
}

export async function runBinanceStreamClient() {
  const symbols = readSymbols();
  const url = buildStreamUrl(symbols);
  console.log(`[ws-client] connecting symbols=${symbols.join(",")}`);

  while (true) {
    try {
      const socket = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error("websocket_open_failed"));
      });
      reconnectDelayMs = 1000;
      console.log("[ws-client] connected");
      await consumeSocket(socket);
    } catch (error) {
      console.warn(
        `[ws-client] disconnected: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, reconnectDelayMs));
    reconnectDelayMs = Math.min(30_000, reconnectDelayMs * 2);
  }
}
