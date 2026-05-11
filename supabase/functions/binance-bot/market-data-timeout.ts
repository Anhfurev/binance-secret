// @ts-nocheck
import ccxt from "ccxt";

/** Bound CCXT timeout for one snapshot fetch; restores prior value (shared exchange instance). */
export async function withBoundedPublicExchangeTimeout<T>(
  exchange: InstanceType<typeof ccxt.binance>,
  signal: AbortSignal | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = exchange.timeout;
  if (signal) {
    exchange.timeout = Math.min(prev ?? 10_000, 8_000);
  }
  try {
    return await fn();
  } finally {
    exchange.timeout = prev;
  }
}
