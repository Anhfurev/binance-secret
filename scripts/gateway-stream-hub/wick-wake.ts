import {
  readWakeCooldownMs,
  readWakeSecret,
  readWakeUrl,
  readWickDropPct,
} from "./config.ts";
import { getRollingHigh } from "./symbol-store.ts";

const lastWakeAt = new Map<string, number>();

export async function maybeWakeBotOnWick(symbol: string, price: number, ts: number) {
  const dropPct = readWickDropPct(symbol);
  if (dropPct == null) return;
  const wakeUrl = readWakeUrl();
  const wakeSecret = readWakeSecret();
  if (!wakeUrl || !wakeSecret) return;

  const high = getRollingHigh(symbol);
  if (!high || !(high.price > 0) || !(price > 0)) return;
  if (ts - high.ts > 90_000) return;

  const drop = ((high.price - price) / high.price) * 100;
  if (drop < dropPct) return;

  const key = symbol.toUpperCase();
  const now = Date.now();
  const cooldownMs = readWakeCooldownMs();
  const last = lastWakeAt.get(key) ?? 0;
  if (now - last < cooldownMs) return;
  lastWakeAt.set(key, now);

  try {
    const response = await fetch(wakeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-binance-bot-secret": wakeSecret,
      },
      body: JSON.stringify({
        symbols: [key],
        trigger: "stream_wick",
        stream: {
          symbol: key,
          price,
          rolling_high: high.price,
          drop_pct: Number(drop.toFixed(4)),
        },
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.warn(
        `[wick-wake] ${key} wake failed status=${response.status} detail=${detail.slice(0, 200)}`,
      );
      return;
    }
    console.log(
      `[wick-wake] ${key} wake sent drop=${drop.toFixed(3)}% high=${high.price} px=${price}`,
    );
  } catch (error) {
    console.warn(
      `[wick-wake] ${key} wake error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
