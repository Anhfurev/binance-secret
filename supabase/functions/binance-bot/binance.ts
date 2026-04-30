// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { BINANCE_BASE_URL, SUPPORTED_SYMBOLS } from "./constants.ts";
import type { IndicatorSnapshot } from "./types.ts";
import { toStringValue } from "./utils.ts";
import {
  assertExpectedEgressIpOrThrow,
  executeSmartLimitChaser,
  formatAmount,
  getTotalAccountBalanceUsdt,
  getUsdtBalance,
  normalizePriceForSymbol,
} from "./exchange-client.ts";
import { fetchIndicatorSnapshotFromMarket } from "./market-data.ts";
import { logCcxtOrderError, logTradeAction } from "./trading-logger.ts";

export { getUsdtBalance };
export { getTotalAccountBalanceUsdt };

const BINANCE_JITTER_MIN_MS = 100;
const BINANCE_JITTER_MAX_MS = 500;
const MAX_RETRY_AFTER_SECONDS = 5;

async function applyBinanceJitter() {
  const waitMs = Math.floor(
    Math.random() * (BINANCE_JITTER_MAX_MS - BINANCE_JITTER_MIN_MS + 1),
  ) + BINANCE_JITTER_MIN_MS;
  await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
}

export async function applyBinanceCycleJitter() {
  await applyBinanceJitter();
}

/**
 * Thin wrapper over fetch() used for unauthenticated Binance endpoints
 * (currently only /api/v3/time). Test/live mode is now decided per-order at
 * the createOrder layer, so this helper no longer intercepts POSTs.
 */
export async function binanceFetch(
  input: string | URL,
  init: RequestInit & { method?: string } = {},
): Promise<Response> {
  const url = typeof input === "string" ? new URL(input) : input;
  try {
    const response = await fetch(url, init);
    if (response.status === 429) {
      await delayFromRetryAfterHeader(
        response.headers.get("Retry-After") ?? response.headers.get("retry-after"),
      );
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isDdosProtection = message.includes("DDoSProtection") || message.includes("429");
    if (isDdosProtection) {
      await delayFromRetryAfterHeader(extractRetryAfterFromUnknownError(error));
    }
    throw error;
  }
}

function extractRetryAfterFromUnknownError(error: unknown): string | null {
  const headers = (error as any)?.response?.headers;
  if (!headers) return null;
  if (typeof headers.get === "function") {
    return headers.get("Retry-After") ?? headers.get("retry-after");
  }
  const retryAfter = headers["Retry-After"] ?? headers["retry-after"];
  return typeof retryAfter === "string" ? retryAfter : null;
}

function parseRetryAfterSeconds(raw: string): number | null {
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.ceil(asNumber);
  }
  const asDateMs = Date.parse(raw);
  if (!Number.isFinite(asDateMs)) return null;
  return Math.max(0, Math.ceil((asDateMs - Date.now()) / 1000));
}

async function delayFromRetryAfterHeader(retryAfterHeader: string | null) {
  if (!retryAfterHeader) return;
  const retryAfterSeconds = parseRetryAfterSeconds(retryAfterHeader);
  if (retryAfterSeconds === null) return;
  if (retryAfterSeconds > MAX_RETRY_AFTER_SECONDS) {
    throw new Error(
      `BINANCE_RETRY_AFTER_TOO_LONG:${retryAfterSeconds}s>${MAX_RETRY_AFTER_SECONDS}s`,
    );
  }
  console.warn(`Binance Rate Limit Hit - Sleeping for ${retryAfterSeconds} seconds`);
  await new Promise<void>((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
}

export async function binanceTimeSyncCheck() {
  const url = new URL(`${BINANCE_BASE_URL}/api/v3/time`);
  const response = await binanceFetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Binance time check failed: ${response.status} ${detail}`);
  }

  const data = (await response.json()) as { serverTime?: number };
  const serverTime = typeof data.serverTime === "number" ? data.serverTime : 0;
  if (!serverTime) throw new Error("Binance time check missing serverTime");

  const driftMs = Math.abs(Date.now() - serverTime);
  return { serverTime, driftMs };
}

export async function fetchIndicatorSnapshot(
  symbol: string,
  signal?: AbortSignal,
): Promise<IndicatorSnapshot> {
  const normalizedSymbol = String(symbol ?? "").toUpperCase();
  if (!SUPPORTED_SYMBOLS.includes(normalizedSymbol as (typeof SUPPORTED_SYMBOLS)[number])) {
    throw new Error(`Unsupported symbol for indicator fetch: ${normalizedSymbol}`);
  }
  return fetchIndicatorSnapshotFromMarket(normalizedSymbol, signal);
}

export async function createOrder(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  botId?: string;
  /** One id per HTTP/cron invocation; blocks duplicate BUY/SELL in the same cycle. */
  cycleId?: string;
  symbol: string;
  side: "buy" | "sell";
  amount: number;
  /** Signal / snapshot price for slippage guard and VWAP vs signal (buy + sell). */
  referencePrice?: number;
  /** From 1h snapshot — drives post-chase market fallback (TRENDING vs RANGING). */
  marketRegime?: string;
  /** Max deviation from signal price (percent points, e.g. 0.2 = 0.2%). */
  maxSlippagePct?: number;
  /**
   * When true, short-circuits CCXT and returns a mock FILLED order. Decided by
   * the caller per-bot (via `resolveTestMode(row)`) — no longer a global flag.
   */
  isTestMode: boolean;
}) {
  const {
    supabase,
    userId,
    botId,
    cycleId,
    symbol,
    side,
    amount,
    isTestMode,
    referencePrice,
    marketRegime,
    maxSlippagePct,
  } = params;
  const sideType = side.toLowerCase();

  if (botId && cycleId) {
    const existing = await supabase
      .from("trades")
      .select("id, exchange_order_id, signalId")
      .eq("user_id", userId)
      .eq("symbol", symbol)
      .eq("type", sideType)
      .eq("extra->>bot_id", botId)
      .eq("extra->>cycle_id", cycleId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing.error) {
      throw new Error(
        `Idempotency lookup failed: ${existing.error.message}`,
      );
    }

    if (existing.data) {
      const exchangeOrderId = toStringValue((existing.data as any)?.exchange_order_id);
      const signalId = toStringValue((existing.data as any)?.signalId);
      return {
        idempotent: true,
        exchange_order_id: exchangeOrderId ?? signalId ?? null,
        status: "duplicate_skipped",
        symbol,
        side,
        amount,
      };
    }
  }

  if (isTestMode) {
    await logTradeAction({
      supabase,
      action: "TEST MODE BUY/SELL",
      level: "info",
      userId,
      symbol,
      source: "ccxt",
      data: { side, amount, price: "MARKET" },
    });
    return {
      exchange_order_id: `test-${Date.now()}`,
      symbol,
      side,
      type: "market",
      amount,
      status: "closed",
      testMode: true,
    };
  }

  try {
    await assertExpectedEgressIpOrThrow();
    const precisionAmount = await formatAmount(symbol, amount);
    const signalPx = Number(referencePrice);
    if (!Number.isFinite(signalPx) || signalPx <= 0) {
      throw new Error(
        `createOrder: referencePrice required for live ${side} (signal/snapshot price for slippage guard)`,
      );
    }
    const normalizedSignalPrice = await normalizePriceForSymbol(symbol, signalPx);
    const order = await executeSmartLimitChaser({
      symbol,
      side,
      amount: Number(precisionAmount),
      signalPrice: Number.isFinite(normalizedSignalPrice) && normalizedSignalPrice > 0
        ? normalizedSignalPrice
        : signalPx,
      maxSlippagePct: maxSlippagePct ?? 0.2,
      marketRegime: String(marketRegime ?? "NEUTRAL"),
    });
    await logTradeAction({
      supabase,
      action: "CCXT smart limit chase executed",
      level: "info",
      userId,
      symbol,
      source: "ccxt",
      data: {
        side,
        requested_amount: amount,
        precision_amount: Number(precisionAmount),
        order_id: toStringValue((order as any)?.id),
        execution_type: (order as any)?.execution_type,
        actual_slippage_pct: (order as any)?.actual_slippage_pct,
      },
    });
    const filledBase = Number((order as any)?.amount ?? precisionAmount);
    return {
      exchange_order_id: toStringValue((order as any)?.id) ?? null,
      status: toStringValue((order as any)?.status) ?? "unknown",
      symbol,
      side,
      idempotent: false,
      amount: Number.isFinite(filledBase) && filledBase > 0 ? filledBase : Number(precisionAmount),
      average: (order as any)?.average,
      price: (order as any)?.price,
      execution_type: (order as any)?.execution_type,
      actual_slippage_pct: (order as any)?.actual_slippage_pct,
      smart_execution_meta: (order as any)?.smart_execution_meta,
      raw: order,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("slippage_limit_exceeded")) {
      await logTradeAction({
        supabase,
        action: "slippage_limit_exceeded",
        level: "warn",
        userId,
        symbol,
        source: "ccxt",
        data: { side, amount, referencePrice },
      });
    }
    await logCcxtOrderError({ supabase, userId, symbol, side, amount, error });
    throw error;
  }
}
