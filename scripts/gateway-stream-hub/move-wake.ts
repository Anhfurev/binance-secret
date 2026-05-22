import { readMoveWakePct } from "./config.ts";
import { postBotWake } from "./bot-wake-client.ts";

const refPriceBySymbol = new Map<string, number>();

export async function maybeWakeBotOnMove(symbol: string, price: number) {
  const movePct = readMoveWakePct(symbol);
  if (movePct == null || !(price > 0)) return;

  const key = symbol.toUpperCase();
  const ref = refPriceBySymbol.get(key);
  if (ref == null || !(ref > 0)) {
    refPriceBySymbol.set(key, price);
    return;
  }

  const move = Math.abs((price - ref) / ref) * 100;
  if (move < movePct) return;

  const direction = price >= ref ? "up" : "down";
  const ok = await postBotWake({
    symbol: key,
    trigger: "stream_move",
    stream: {
      symbol: key,
      price,
      ref_price: ref,
      move_pct: Number(move.toFixed(4)),
      direction,
    },
  });
  if (ok) {
    refPriceBySymbol.set(key, price);
    console.log(
      `[move-wake] ${key} ${direction} ${move.toFixed(3)}% ref=${ref} px=${price}`,
    );
  }
}
