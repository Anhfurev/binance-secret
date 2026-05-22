import { readWickDropPct } from "./config.ts";
import { postBotWake } from "./bot-wake-client.ts";
import { getRollingHigh } from "./symbol-store.ts";

export async function maybeWakeBotOnWick(symbol: string, price: number, ts: number) {
  const dropPct = readWickDropPct(symbol);
  if (dropPct == null) return;

  const high = getRollingHigh(symbol);
  if (!high || !(high.price > 0) || !(price > 0)) return;
  if (ts - high.ts > 90_000) return;

  const drop = ((high.price - price) / high.price) * 100;
  if (drop < dropPct) return;

  const key = symbol.toUpperCase();
  const ok = await postBotWake({
    symbol: key,
    trigger: "stream_wick",
    stream: {
      symbol: key,
      price,
      rolling_high: high.price,
      drop_pct: Number(drop.toFixed(4)),
    },
  });
  if (ok) {
    console.log(
      `[wick-wake] ${key} drop=${drop.toFixed(3)}% high=${high.price} px=${price}`,
    );
  }
}
