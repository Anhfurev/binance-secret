// @ts-nocheck
/** Resilient Binance REST dispatch with exponential backoff + critical alerts. */
import { sendTelegramAlert } from "./notifier.ts";
import { formatUnknownError } from "./utils.ts";

const DEFAULT_DELAYS_MS = [500, 1000, 2000] as const;
const MAX_ATTEMPTS = 3;

export function isTransientExchangeError(error: unknown): boolean {
  const msg = formatUnknownError(error).toLowerCase();
  return (
    msg.includes("timeout")
    || msg.includes("timed out")
    || msg.includes("network")
    || msg.includes("econnreset")
    || msg.includes("econnrefused")
    || msg.includes("socket")
    || msg.includes("fetch failed")
    || msg.includes("request timed out")
    || msg.includes("502")
    || msg.includes("503")
    || msg.includes("504")
    || msg.includes("429")
    || msg.includes("rate limit")
    || msg.includes("ddos")
    || msg.includes("exchange_not_available")
    || msg.includes("service unavailable")
  );
}

function sleepMs(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** High-priority operator alert (Telegram when configured). */
export async function triggerTelegramAlert(
  message: string,
  opts?: { cycleId?: string | null },
): Promise<void> {
  try {
    await sendTelegramAlert(message, { cycleId: opts?.cycleId ?? null });
  } catch (e) {
    console.error(
      `[CRITICAL_EXCHANGE_ERROR] triggerTelegramAlert failed: ${formatUnknownError(e)}`,
    );
  }
}

export async function logCriticalExchangeError(params: {
  label: string;
  detail: string;
  symbol?: string;
  side?: string;
  cycleId?: string | null;
  attempts?: number;
}): Promise<void> {
  const { label, detail, symbol, side, cycleId, attempts = MAX_ATTEMPTS } = params;
  console.error(
    `[CRITICAL_EXCHANGE_ERROR] label=${label} symbol=${symbol ?? "n/a"} side=${side ?? "n/a"} attempts=${attempts} detail=${detail.slice(0, 500)}`,
  );
  await triggerTelegramAlert(
    `🚨 <b>[CRITICAL_EXCHANGE_ERROR]</b>\n` +
      `<b>Op:</b> ${label}\n` +
      `<b>Symbol:</b> ${symbol ?? "n/a"} · <b>Side:</b> ${side ?? "n/a"}\n` +
      `<b>Attempts:</b> ${attempts}\n` +
      `<b>Detail:</b> <code>${detail.slice(0, 280)}</code>`,
    { cycleId },
  );
}

/**
 * Run a live exchange dispatch up to 3 times (500ms → 1s → 2s backoff).
 * Rethrows after logging if all attempts fail.
 */
export async function runExchangeDispatchWithRetry<T>(
  label: string,
  fn: () => Promise<T>,
  meta?: { symbol?: string; side?: string; cycleId?: string | null },
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const detail = formatUnknownError(error);
      const transient = isTransientExchangeError(error);
      console.warn(
        `[exchange-retry] ${label} attempt=${attempt + 1}/${MAX_ATTEMPTS} transient=${transient ? 1 : 0} ${detail.slice(0, 200)}`,
      );
      if (attempt >= MAX_ATTEMPTS - 1) break;
      if (!transient && attempt === 0) {
        const hardAuth = detail.toLowerCase().includes("invalid api")
          || detail.includes("-2015")
          || detail.includes("insufficient");
        if (hardAuth) break;
      }
      await sleepMs(DEFAULT_DELAYS_MS[attempt] ?? 2000);
    }
  }
  const detail = formatUnknownError(lastError);
  await logCriticalExchangeError({
    label,
    detail,
    symbol: meta?.symbol,
    side: meta?.side,
    cycleId: meta?.cycleId,
  });
  throw lastError instanceof Error ? lastError : new Error(detail);
}
