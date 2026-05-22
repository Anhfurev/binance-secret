import { readWakeCooldownMs, readWakeSecret, readWakeUrl } from "./config.ts";

const lastWakeAt = new Map<string, number>();

export function canWakeSymbol(symbol: string): boolean {
  const key = symbol.toUpperCase();
  const now = Date.now();
  const last = lastWakeAt.get(key) ?? 0;
  return now - last >= readWakeCooldownMs();
}

export function markSymbolWoke(symbol: string): void {
  lastWakeAt.set(symbol.toUpperCase(), Date.now());
}

export async function postBotWake(params: {
  symbol: string;
  trigger: string;
  stream?: Record<string, unknown>;
}): Promise<boolean> {
  const wakeUrl = readWakeUrl();
  const wakeSecret = readWakeSecret();
  if (!wakeUrl || !wakeSecret) return false;

  const key = params.symbol.toUpperCase();
  if (!canWakeSymbol(key)) return false;

  try {
    const response = await fetch(wakeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-binance-bot-secret": wakeSecret,
      },
      body: JSON.stringify({
        symbols: [key],
        trigger: params.trigger,
        stream: params.stream,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.warn(
        `[stream-wake] ${key} ${params.trigger} failed status=${response.status} detail=${detail.slice(0, 200)}`,
      );
      return false;
    }
    markSymbolWoke(key);
    return true;
  } catch (error) {
    console.warn(
      `[stream-wake] ${key} ${params.trigger} error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
