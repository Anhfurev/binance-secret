// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { SUPPORTED_SYMBOLS } from "./constants.ts";
import { resolveBinanceRestBaseUrl } from "./binance-rest-base.ts";
import { gatewayFetch } from "./gateway-http-client.ts";
import type { IndicatorSnapshot } from "./types.ts";
import { toStringValue } from "./utils.ts";
import {
  assertExpectedEgressIpOrThrow,
  executeSmartLimitChaser,
  executeMarketOrder,
  formatAmount,
  getTotalAccountBalanceUsdt,
  getUsdtBalance,
  normalizePriceForSymbol,
} from "./exchange-client.ts";
import { fetchIndicatorSnapshotFromMarket } from "./market-data.ts";
import { readSmartLimitMaxSlippagePct } from "./smart-limit-chase-config.ts";
import { logCcxtOrderError, logTradeAction } from "./trading-logger.ts";
import { preflightCreateOrderIdempotencyAndLock } from "./binance-create-preflight.ts";
import { runPaperCreateOrder } from "./binance-paper-order.ts";
import { releaseTradeExecutionLock } from "./trade-execution-lock.ts";

export { getUsdtBalance };
export { getTotalAccountBalanceUsdt };

const BINANCE_JITTER_MIN_MS = 100;
const BINANCE_JITTER_MAX_MS = 500;
const MAX_RETRY_AFTER_SECONDS = 5;
const DEFAULT_TIME_SYNC_TTL_MS = 5 * 60 * 1000;
let lastTimeSyncAtMs = 0;
let lastTimeSyncResult: { serverTime: number; driftMs: number } | null = null;

function readTimeSyncTtlMs(): number {
  const raw = String(Deno.env.get("BINANCE_TIME_SYNC_INTERVAL_MS") ?? "").trim();
  const n = raw.length ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_TIME_SYNC_TTL_MS;
  return Math.min(30 * 60 * 1000, Math.max(60_000, Math.floor(n)));
}

function isCycleJitterDisabled(): boolean {
  const flag = String(Deno.env.get("BOT_DISABLE_CYCLE_JITTER") ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

async function applyBinanceJitter() {
  if (isCycleJitterDisabled()) return;
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
    const response = await gatewayFetch(url, init);
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
  const now = Date.now();
  const ttlMs = readTimeSyncTtlMs();
  if (lastTimeSyncResult && now - lastTimeSyncAtMs < ttlMs) {
    return lastTimeSyncResult;
  }

  const url = new URL(`${resolveBinanceRestBaseUrl()}/api/v3/time`);
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
  lastTimeSyncAtMs = now;
  lastTimeSyncResult = { serverTime, driftMs };
  return lastTimeSyncResult;
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
  /** Cancels public book-ticker fetch on paper path when the cron cycle aborts. */
  signal?: AbortSignal;
  /** `market` submits an immediate market order on live; paper uses market-style fill. */
  executionMode?: "smart_limit" | "market";
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
    signal,
    executionMode = "smart_limit",
  } = params;
  const sideType = side.toLowerCase();

  const preflight = await preflightCreateOrderIdempotencyAndLock({
    supabase,
    userId,
    symbol,
    sideType,
    amount,
    botId,
    cycleId,
  });
  if (preflight.action === "idempotent") {
    return { ...preflight.payload, side };
  }

  if (isTestMode) {
    return await runPaperCreateOrder({
      supabase,
      userId,
      symbol,
      side,
      amount,
      marketRegime: String(marketRegime ?? "NEUTRAL"),
      signalPx: Number(referencePrice),
      signal,
      botId,
      cycleId,
      sideType,
    });
  }

  const lockHeld = Boolean(botId && cycleId);
  let orderFilled = false;
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
    const order = executionMode === "market"
      ? await executeMarketOrder(symbol, side, Number(precisionAmount), {
        referencePrice: Number.isFinite(normalizedSignalPrice) && normalizedSignalPrice > 0
          ? normalizedSignalPrice
          : signalPx,
      })
      : await executeSmartLimitChaser({
        symbol,
        side,
        amount: Number(precisionAmount),
        signalPrice: Number.isFinite(normalizedSignalPrice) && normalizedSignalPrice > 0
          ? normalizedSignalPrice
          : signalPx,
        maxSlippagePct: maxSlippagePct ?? readSmartLimitMaxSlippagePct(symbol),
        marketRegime: String(marketRegime ?? "NEUTRAL"),
      });
    await logTradeAction({
      supabase,
      action: executionMode === "market"
        ? "CCXT market order executed"
        : "CCXT smart limit chase executed",
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
    const filledBase = Number(
      (order as any)?.filled ?? (order as any)?.amount ?? precisionAmount,
    );
    orderFilled = true;
    return {
      exchange_order_id: toStringValue((order as any)?.id) ?? null,
      status: toStringValue((order as any)?.status) ?? "unknown",
      symbol,
      side,
      idempotent: false,
      amount: Number.isFinite(filledBase) && filledBase > 0 ? filledBase : Number(precisionAmount),
      average: (order as any)?.average,
      price: (order as any)?.price,
      execution_type: executionMode === "market"
        ? "market"
        : (order as any)?.execution_type,
      actual_slippage_pct: (order as any)?.actual_slippage_pct,
      smart_execution_meta: (order as any)?.smart_execution_meta,
      raw: order,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("slippage_limit_exceeded") || msg.includes("smart_limit_max_chase_exceeded")) {
      await logTradeAction({
        supabase,
        action: msg.includes("smart_limit_max_chase_exceeded")
          ? "smart_limit_max_chase_exceeded"
          : "slippage_limit_exceeded",
        level: "warn",
        userId,
        symbol,
        source: "ccxt",
        data: { side, amount, referencePrice },
      });
    }
    await logCcxtOrderError({ supabase, userId, symbol, side, amount, error });
    throw error;
  } finally {
    if (lockHeld && !orderFilled && botId && cycleId) {
      await releaseTradeExecutionLock({
        supabase,
        botId: String(botId),
        cycleId: String(cycleId),
        side: sideType as "buy" | "sell",
      });
    }
  }
}
