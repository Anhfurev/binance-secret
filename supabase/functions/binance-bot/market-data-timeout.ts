// @ts-nocheck
import ccxt from "ccxt";

/** Bound CCXT timeout for one snapshot fetch; restores prior value (shared exchange instance). */
export async function withBoundedPublicExchangeTimeout<T>(
  exchange: InstanceType<typeof ccxt.binance>,
  signal: AbortSignal | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = exchange.timeout;
  const cap = readPublicMarketDataTimeoutMs(signal);
  exchange.timeout = cap;
  try {
    return await fn();
  } finally {
    exchange.timeout = prev;
  }
}

export function readPublicMarketDataTimeoutMs(signal?: AbortSignal): number {
  const raw = String(Deno.env.get("PUBLIC_MARKET_DATA_TIMEOUT_MS") ?? "").trim();
  const n = raw.length ? Number(raw) : NaN;
  const fallback = 10_000;
  const base = Number.isFinite(n) ? n : fallback;
  const bounded = Math.min(20_000, Math.max(3_000, Math.floor(base)));
  return signal ? Math.min(bounded, 8_000) : bounded;
}
