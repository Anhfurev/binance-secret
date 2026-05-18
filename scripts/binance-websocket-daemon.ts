/**
 * 24/7 Binance 15m kline WebSocket → velocity wake → local paper/run.
 * Run: npx tsx scripts/binance-websocket-daemon.ts
 * PM2: pm2 start npm --name binance-ws-daemon -- run ws:daemon
 */
import WebSocket from "ws";
import { seedAllSymbolsFromRest } from "./binance-ws-daemon/rest-seed";
import { buildCombinedKline15mUrl } from "./binance-ws-daemon/symbols";
import { handleKlineEvent } from "./binance-ws-daemon/velocity-watch";

const PING_MS = 3 * 60_000;
const RECONNECT_MAX_MS = 60_000;

let socket: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let reconnectDelayMs = 1_000;
let shouldRun = true;

function clearPing() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
}

function scheduleReconnect() {
  if (!shouldRun) return;
  const delay = reconnectDelayMs;
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
  console.warn(`[ws-daemon] reconnect in ${delay}ms`);
  setTimeout(() => {
    void connect();
  }, delay);
}

async function connect(): Promise<void> {
  const url = buildCombinedKline15mUrl();
  socket = new WebSocket(url);

  socket.on("open", () => {
    reconnectDelayMs = 1_000;
    console.log("[ws-daemon] connected (15m klines × 10)");
    clearPing();
    pingTimer = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.ping();
    }, PING_MS);
  });

  socket.on("pong", () => {
    /* Binance answers application-level ping via ws.ping() */
  });

  socket.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as {
        stream?: string;
        data?: { e?: string; s?: string; k?: Record<string, unknown> };
      };
      const data = msg.data;
      if (!data || data.e !== "kline" || !data.k || !data.s) return;
      void handleKlineEvent(data.s, data.k);
    } catch {
      /* ignore malformed frames */
    }
  });

  socket.on("close", () => {
    clearPing();
    socket = null;
    scheduleReconnect();
  });

  socket.on("error", (err) => {
    console.warn("[ws-daemon] socket error", err.message);
    socket?.terminate();
  });
}

async function main(): Promise<void> {
  await seedAllSymbolsFromRest();
  await connect();

  const shutdown = () => {
    shouldRun = false;
    clearPing();
    socket?.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[ws-daemon] fatal", err);
  process.exit(1);
});
