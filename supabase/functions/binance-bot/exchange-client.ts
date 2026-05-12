// @ts-nocheck
import ccxt from "ccxt";
import {
  ccxtBinanceOptionsForRestGateway,
  shouldSkipEgressIpCheck,
} from "./binance-rest-base.ts";
import {
  readSmartLimitMaxChasePct,
  readSmartLimitMaxSlippagePct,
} from "./smart-limit-chase-config.ts";

export function toCcxtSymbol(symbol: string) {
  if (symbol.includes("/")) return symbol;
  if (symbol.endsWith("USDT")) return `${symbol.slice(0, -4)}/USDT`;
  return symbol;
}

export function createBinanceExchange() {
  const apiKey = Deno.env.get("BINANCE_API_KEY") ?? "";
  const secret =
    Deno.env.get("BINANCE_SECRET") ?? Deno.env.get("BINANCE_API_SECRET") ?? "";

  if (!apiKey || !secret) {
    throw new Error("Missing BINANCE_API_KEY or BINANCE_SECRET");
  }

  return new ccxt.binance({
    apiKey,
    secret,
    // Keep CCXT-side pacing on for all REST calls.
    enableRateLimit: true,
    options: {
      defaultType: "spot",
      recvWindow: 60_000,
    },
    ...ccxtBinanceOptionsForRestGateway(),
  });
}

let sharedSignedBinance: InstanceType<typeof ccxt.binance> | null = null;

/** One authenticated CCXT instance per warm isolate (fewer allocations; sequential callers only). */
export function getSharedBinanceSignedExchange(): InstanceType<typeof ccxt.binance> {
  if (!sharedSignedBinance) {
    sharedSignedBinance = createBinanceExchange();
  }
  return sharedSignedBinance;
}

/** Binance spot STP — passed on each order; ignored if unsupported by account. */
export function ccxtSelfTradePreventionParams(): Record<string, string> {
  return { selfTradePreventionMode: "EXPIRE_MAKER" };
}

let egressIpCheckCache: { fingerprint: string; ip: string; atMs: number } | null = null;
/** Re-use a fresh echo result for a few seconds (same cron tick: bot preflight + nested createOrder). */
const EGRESS_IP_CACHE_MS = 8000;

/**
 * When set (comma-separated IPv4/IPv6 allowed), live order paths must match
 * outbound IP seen by a public echo service — mitigates proxy / egress drift
 * vs Binance API-key IP allowlists (2026-style hardening; opt-in).
 *
 * Note: there is no `Deno.createHttpClient` proxy wiring on CCXT in this repo;
 * traffic uses the runtime default fetch. For static-IP products, configure
 * Supabase / platform egress and set `BINANCE_REQUIRED_EGRESS_IP` to match.
 */
export async function assertExpectedEgressIpOrThrow(): Promise<void> {
  if (shouldSkipEgressIpCheck()) return;
  const raw = Deno.env.get("BINANCE_REQUIRED_EGRESS_IP")?.trim() ??
    Deno.env.get("BINANCE_STATIC_IP_WHITELIST")?.trim();
  if (!raw) return;

  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return;

  const fingerprint = allowed.join(",");
  const now = Date.now();
  if (
    egressIpCheckCache &&
    egressIpCheckCache.fingerprint === fingerprint &&
    now - egressIpCheckCache.atMs < EGRESS_IP_CACHE_MS &&
    allowed.includes(egressIpCheckCache.ip)
  ) {
    return;
  }

  const echoUrl =
    Deno.env.get("BINANCE_EGRESS_CHECK_URL")?.trim() ??
    "https://api.ipify.org?format=json";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  let observed: string;
  try {
    const res = await fetch(echoUrl, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(
        `egress_ip_check_http_${res.status}: cannot verify outbound IP (aborting trade)`,
      );
    }
    const j = (await res.json()) as { ip?: string };
    observed = String(j?.ip ?? "").trim();
  } finally {
    clearTimeout(t);
  }
  if (!observed) {
    throw new Error("egress_ip_check_empty: public IP echo returned no ip (aborting trade)");
  }
  if (!allowed.includes(observed)) {
    throw new Error(
      `egress_ip_mismatch: outbound=${observed} allowed=${allowed.join("|")} — abort to protect API key`,
    );
  }
  egressIpCheckCache = { fingerprint, ip: observed, atMs: now };
}

function isLikelyCcxtRateLimitError(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e).toLowerCase();
  const http = Number((e as any)?.httpStatus ?? (e as any)?.status ?? 0);
  if (http === 429) return true;
  if (
    m.includes("429") ||
    m.includes("ratelimit") ||
    m.includes("rate limit") ||
    m.includes("ddosprotection") ||
    m.includes("too many requests") ||
    m.includes("way too many requests") ||
    m.includes("banned until") ||
    m.includes("-1003")
  ) {
    return true;
  }
  const name = String((e as any)?.name ?? "");
  if (name.includes("DDoS") || name.includes("RateLimit")) return true;
  return false;
}

function parseRetryAfterMsFromCcxtError(e: unknown): number | null {
  const h = (e as any)?.response?.headers;
  if (h && typeof h.get === "function") {
    const ra = h.get("Retry-After") ?? h.get("retry-after");
    if (ra != null) {
      const sec = Number(ra);
      if (Number.isFinite(sec) && sec >= 0) return Math.min(120_000, Math.ceil(sec * 1000));
      const d = Date.parse(String(ra));
      if (Number.isFinite(d)) return Math.min(120_000, Math.max(0, d - Date.now()));
    }
  }
  return null;
}

async function sleepRateLimitBackoff(e: unknown, attempt: number) {
  const fromHeader = parseRetryAfterMsFromCcxtError(e);
  const base = fromHeader ?? Math.min(30_000, 1500 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 400);
  await new Promise<void>((r) => setTimeout(r, base + jitter));
}

const BINANCE_JITTER_MIN_MS = 100;
const BINANCE_JITTER_MAX_MS = 500;

async function applyBinanceJitter() {
  // Jitter is now applied once per bot cycle in run-symbol-batch.ts.
  // Keep this helper as a no-op to avoid per-call cumulative latency.
  return;
}

/** Binance spot MIN_NOTIONAL / NOTIONAL min trade value in quote (USDT). */
export function readMinNotionalUsdt(market: any): number | null {
  const filters = Array.isArray(market?.info?.filters) ? market.info.filters : [];
  for (const f of filters) {
    const t = String(f?.filterType ?? "");
    if (t === "MIN_NOTIONAL" || t === "NOTIONAL") {
      const raw = f?.minNotional ?? f?.notional;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  const ccxtMin = market?.limits?.cost?.min;
  if (Number.isFinite(ccxtMin) && ccxtMin > 0) return Number(ccxtMin);
  return null;
}

/** Round a quote or base price to Binance PRICE_FILTER tickSize (fallback: CCXT precision). */
export async function normalizePriceForSymbol(symbol: string, price: number): Promise<number> {
  if (!Number.isFinite(price) || price <= 0) return price;
  try {
    const exchange = getSharedBinanceSignedExchange();
    const ccxtSymbol = toCcxtSymbol(symbol);
    await applyBinanceJitter();
    await exchange.loadMarkets();
    const market = exchange.market(ccxtSymbol) as any;
    const filters = Array.isArray(market?.info?.filters) ? market.info.filters : [];
    const pf = filters.find((f: any) => f?.filterType === "PRICE_FILTER");
    const tick = Number(pf?.tickSize);
    if (Number.isFinite(tick) && tick > 0) {
      const floored = Math.floor(price / tick) * tick;
      return Number(exchange.priceToPrecision(ccxtSymbol, floored));
    }
    return Number(exchange.priceToPrecision(ccxtSymbol, price));
  } catch {
    return price;
  }
}

/** Floor to PRICE_FILTER tick using an already-loaded market (no extra REST). */
export function roundPriceToMarketPrecision(
  exchange: InstanceType<typeof ccxt.binance>,
  ccxtSymbol: string,
  market: any,
  price: number,
): number {
  if (!Number.isFinite(price) || price <= 0) return price;
  const filters = Array.isArray(market?.info?.filters) ? market.info.filters : [];
  const pf = filters.find((f: any) => f?.filterType === "PRICE_FILTER");
  const tick = Number(pf?.tickSize);
  let p = price;
  if (Number.isFinite(tick) && tick > 0) {
    p = Math.floor(price / tick) * tick;
  }
  return Number(exchange.priceToPrecision(ccxtSymbol, p));
}

function floorAmountToLotStep(
  exchange: any,
  ccxtSymbol: string,
  market: any,
  raw: number,
): string {
  const filters = Array.isArray(market?.info?.filters) ? market.info.filters : [];
  const rawStep = filters.find((f: any) => f?.filterType === "LOT_SIZE")?.stepSize;
  const stepSize = Number(rawStep);
  let v = raw;
  if (Number.isFinite(stepSize) && stepSize > 0 && Number.isFinite(v)) {
    v = Math.floor(v / stepSize) * stepSize;
  }
  return exchange.amountToPrecision(ccxtSymbol, v);
}

export async function formatAmount(symbol: string, amount: number) {
  const exchange = getSharedBinanceSignedExchange();
  const ccxtSymbol = toCcxtSymbol(symbol);
  await applyBinanceJitter();
  await exchange.loadMarkets();
  const market = exchange.market(ccxtSymbol) as any;
  return floorAmountToLotStep(exchange, ccxtSymbol, market, amount);
}

async function createLimitOrderWithStpRetry(
  exchange: InstanceType<typeof ccxt.binance>,
  ccxtSymbol: string,
  side: "buy" | "sell",
  orderAmount: number,
  limitPrice: number,
  stp: Record<string, string>,
) {
  const params = { timeInForce: "GTC", ...stp };
  try {
    return await exchange.createOrder(ccxtSymbol, "limit", side, orderAmount, limitPrice, params);
  } catch (e: unknown) {
    const m = String((e as Error)?.message ?? e);
    if (m.includes("selfTradePrevention") || m.includes("selfTrade")) {
      return await exchange.createOrder(ccxtSymbol, "limit", side, orderAmount, limitPrice, {
        timeInForce: "GTC",
      });
    }
    throw e;
  }
}

async function createMarketOrderWithStpRetry(
  exchange: InstanceType<typeof ccxt.binance>,
  ccxtSymbol: string,
  side: "buy" | "sell",
  amount: number,
) {
  const stp = ccxtSelfTradePreventionParams();
  try {
    return await exchange.createMarketOrder(ccxtSymbol, side, amount, undefined, stp);
  } catch (e: unknown) {
    const m = String((e as Error)?.message ?? e);
    if (m.includes("selfTradePrevention") || m.includes("selfTrade")) {
      return await exchange.createMarketOrder(ccxtSymbol, side, amount);
    }
    throw e;
  }
}

export type ExecuteMarketOrderOpts = {
  /**
   * BUY only: `amount` is already base qty sized from this price upstream.
   * Skips a second ticker fetch and uses this price for min-notional checks
   * so DB intent and exchange qty stay aligned.
   */
  referencePrice?: number;
};

export async function executeMarketOrder(
  symbol: string,
  side: "buy" | "sell",
  amount: number,
  opts?: ExecuteMarketOrderOpts,
) {
  const exchange = getSharedBinanceSignedExchange();
  const ccxtSymbol = toCcxtSymbol(symbol);
  await applyBinanceJitter();
  await exchange.loadMarkets();
  const market = exchange.market(ccxtSymbol) as any;

  const refPx = Number(opts?.referencePrice ?? 0);
  const useRefPriceForBuy =
    side === "buy" && Number.isFinite(refPx) && refPx > 0;

  let currentPrice: number;
  if (useRefPriceForBuy) {
    currentPrice = refPx;
  } else {
    await applyBinanceJitter();
    const ticker = await exchange.fetchTicker(ccxtSymbol);
    currentPrice = Number(ticker?.last ?? 0);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      throw new Error(`InvalidOrder: invalid ticker price for ${ccxtSymbol}`);
    }
  }

  const minNotionalFilter = readMinNotionalUsdt(market);
  const minNotionalFloor = Number.isFinite(minNotionalFilter) && minNotionalFilter > 0
    ? minNotionalFilter
    : 5;

  let requestedAmountRaw: number;
  if (side === "sell") {
    const free = await getAvailableBalance(symbol, exchange);
    const positionQty = Number(amount);
    const pos = Number.isFinite(positionQty) && positionQty > 0 ? positionQty : 0;
    const fr = Number.isFinite(free) && free > 0 ? free : 0;
    requestedAmountRaw = Math.min(pos, fr);
  } else {
    // Base qty already derived upstream as tradeUsd / snapshotPrice; do not
    // re-size from a fresh ticker (avoids PnL / notional drift).
    requestedAmountRaw = Number(amount);
  }

  const precisionStr = floorAmountToLotStep(
    exchange,
    ccxtSymbol,
    market,
    requestedAmountRaw,
  );
  const finalAmount = Number(
    exchange.amountToPrecision(ccxtSymbol, Number(precisionStr)),
  );
  if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
    throw new Error(
      `InvalidOrder: amount is zero/invalid after precision for ${ccxtSymbol}`,
    );
  }

  const finalNotional = finalAmount * currentPrice;
  if (finalNotional < minNotionalFloor - 1e-12) {
    throw new Error(
      `Below Notional: ${ccxtSymbol} notional=${finalNotional.toFixed(8)} min=${minNotionalFloor}`,
    );
  }

  await applyBinanceJitter();
  return await createMarketOrderWithStpRetry(exchange, ccxtSymbol, side, finalAmount);
}

const CHASE_SLEEP_MS_MIN = 5000;
const CHASE_SLEEP_MS_MAX = 8000;
const SMART_LIMIT_MAX_ROUNDS = 3;

function sleepMs(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function randomChaseSleepMs() {
  return CHASE_SLEEP_MS_MIN +
    Math.floor(Math.random() * (CHASE_SLEEP_MS_MAX - CHASE_SLEEP_MS_MIN + 1));
}

async function safeCancelOrderCcxt(
  exchange: InstanceType<typeof ccxt.binance>,
  orderId: string,
  ccxtSymbol: string,
) {
  try {
    await exchange.cancelOrder(orderId, ccxtSymbol);
  } catch (e: unknown) {
    const m = String((e as Error)?.message ?? e);
    if (
      m.includes("OrderNotFound") ||
      m.includes("-2011") ||
      m.includes("Unknown order") ||
      m.includes("Unknown Order") ||
      m.includes("CancelPending") ||
      m.includes("-2013")
    ) {
      return;
    }
    throw e;
  }
}

export type SmartLimitExecutionResult = {
  id?: string;
  status: string;
  symbol: string;
  side: string;
  amount: number;
  average?: number;
  filled?: number;
  cost?: number;
  price?: number;
  raw?: unknown;
  execution_type: "limit_chase" | "market_fallback" | "limit_chase_cancelled";
  actual_slippage_pct: number | null;
  smart_execution_meta?: Record<string, unknown>;
};

/**
 * Post at best bid (buy) / best ask (sell), wait, chase up to 3 rounds; then
 * market fallback if TRENDING else abort (RANGING/NEUTRAL).
 */
export async function executeSmartLimitChaser(params: {
  symbol: string;
  side: "buy" | "sell";
  /** Base qty (already lot-stepped). */
  amount: number;
  /** Reference price for slippage guard (e.g. snapshot at signal). */
  signalPrice: number;
  maxSlippagePct?: number;
  marketRegime: string;
}): Promise<SmartLimitExecutionResult> {
  const {
    symbol,
    side,
    amount: initialAmount,
    signalPrice,
    marketRegime,
  } = params;
  const maxChasePct = readSmartLimitMaxChasePct(symbol);
  const maxSlippagePct = params.maxSlippagePct ?? readSmartLimitMaxSlippagePct(symbol);
  const maxChaseFrac = maxChasePct / 100;
  const maxSlippageFrac = maxSlippagePct / 100;
  if (!Number.isFinite(signalPrice) || signalPrice <= 0) {
    throw new Error("smart_limit_invalid_signal_price");
  }
  if (!Number.isFinite(initialAmount) || initialAmount <= 0) {
    throw new Error("smart_limit_invalid_amount");
  }

  const exchange = getSharedBinanceSignedExchange();
  const ccxtSymbol = toCcxtSymbol(symbol);
  await applyBinanceJitter();
  await exchange.loadMarkets();
  const market = exchange.market(ccxtSymbol) as any;

  const stp = ccxtSelfTradePreventionParams();
  const meta: Record<string, unknown> = {
    rounds: [] as unknown[],
    signal_price: signalPrice,
    max_chase_pct: maxChasePct,
    max_slippage_pct: maxSlippagePct,
    initial_target_base: initialAmount,
  };

  let remaining = Number(
    exchange.amountToPrecision(
      ccxtSymbol,
      Number(floorAmountToLotStep(exchange, ccxtSymbol, market, initialAmount)),
    ),
  );
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw new Error("smart_limit_amount_zero_after_precision");
  }

  let cumFilled = 0;
  let cumQuote = 0;
  let lastOrderId: string | undefined;
  let execution_type: SmartLimitExecutionResult["execution_type"] = "limit_chase";

  function adverseMoveFrac(refPrice: number): number {
    if (!Number.isFinite(refPrice) || refPrice <= 0 || !Number.isFinite(signalPrice) || signalPrice <= 0) {
      return 0;
    }
    // Slippage guard should only react to adverse drift:
    // - BUY adverse: ref > signal
    // - SELL adverse (closing long): ref < signal
    if (side === "buy") {
      return Math.max(0, (refPrice - signalPrice) / signalPrice);
    }
    return Math.max(0, (signalPrice - refPrice) / signalPrice);
  }

  for (let round = 0; round < SMART_LIMIT_MAX_ROUNDS; round++) {
    if (remaining <= 1e-12) break;

    await applyBinanceJitter();
    const book = await exchange.fetchOrderBook(ccxtSymbol, 20);
    const bestBid = Number(book?.bids?.[0]?.[0] ?? 0);
    const bestAsk = Number(book?.asks?.[0]?.[0] ?? 0);
    const rawLimit = side === "buy" ? bestBid : bestAsk;
    if (!Number.isFinite(rawLimit) || rawLimit <= 0) {
      throw new Error("smart_limit_empty_order_book");
    }
    const limitPrice = roundPriceToMarketPrecision(exchange, ccxtSymbol, market, rawLimit);
    const chaseMove = adverseMoveFrac(limitPrice);
    if (chaseMove > maxChaseFrac) {
      meta.chase_cap_abort_ref = limitPrice;
      meta.chase_cap_frac = chaseMove;
      throw new Error("smart_limit_max_chase_exceeded");
    }
    const amtStr = floorAmountToLotStep(exchange, ccxtSymbol, market, remaining);
    const orderAmount = Number(exchange.amountToPrecision(ccxtSymbol, Number(amtStr)));
    if (!Number.isFinite(orderAmount) || orderAmount <= 0) break;

    const minNotional = readMinNotionalUsdt(market) ?? 5;
    if (orderAmount * limitPrice < minNotional - 1e-12) {
      meta.rounds.push({ round, skipped: "below_min_notional", orderAmount, limitPrice });
      break;
    }

    const order = await createLimitOrderWithStpRetry(
      exchange,
      ccxtSymbol,
      side,
      orderAmount,
      limitPrice,
      stp,
    );
    const oid = String((order as any)?.id ?? "");
    lastOrderId = oid || lastOrderId;
    (meta.rounds as unknown[]).push({
      round,
      order_id: oid,
      limit_price: limitPrice,
      amount: orderAmount,
    });

    await sleepMs(randomChaseSleepMs());

    await applyBinanceJitter();
    let st: any;
    try {
      st = oid ? await exchange.fetchOrder(oid, ccxtSymbol) : order;
    } catch (e: unknown) {
      const m = String((e as Error)?.message ?? e);
      if (m.includes("OrderNotFound") || m.includes("-2011")) {
        (meta.rounds as any[])[(meta.rounds as any[]).length - 1].fetch_missing = true;
        remaining = 0;
        break;
      }
      throw e;
    }

    const status = String(st?.status ?? "").toLowerCase();
    const filled = Number(st?.filled ?? 0);
    const avg = Number(st?.average ?? st?.price ?? limitPrice);

    if (status === "closed" || status === "filled") {
      cumFilled += filled;
      const pxLeg = Number.isFinite(avg) && avg > 0 ? avg : limitPrice;
      cumQuote += filled * pxLeg;
      remaining = Math.max(0, remaining - filled);
      if (remaining <= 1e-12) {
        const vwap = cumFilled > 0 ? cumQuote / cumFilled : limitPrice;
        const slipPct = side === "buy"
          ? ((vwap - signalPrice) / signalPrice) * 100
          : ((signalPrice - vwap) / signalPrice) * 100;
        return {
          id: lastOrderId,
          status: "closed",
          symbol,
          side,
          amount: cumFilled,
          filled: cumFilled,
          average: vwap,
          cost: cumQuote,
          price: vwap,
          raw: st,
          execution_type,
          actual_slippage_pct: Number.isFinite(slipPct) ? Number(slipPct.toFixed(4)) : null,
          smart_execution_meta: meta,
        };
      }
    }

    if (status === "open" || status === "partial" || status === "expired") {
      if (filled > 0) {
        cumFilled += filled;
        const px = Number.isFinite(avg) && avg > 0 ? avg : limitPrice;
        cumQuote += filled * px;
        remaining = Math.max(0, remaining - filled);
      }
      if (oid) await safeCancelOrderCcxt(exchange, oid, ccxtSymbol);
    } else if (status === "canceled" || status === "cancelled") {
      if (filled > 0) {
        cumFilled += filled;
        const px = Number.isFinite(avg) && avg > 0 ? avg : limitPrice;
        cumQuote += filled * px;
        remaining = Math.max(0, remaining - filled);
      }
    } else if (status !== "closed" && status !== "filled") {
      if (filled > 0) {
        cumFilled += filled;
        const px = Number.isFinite(avg) && avg > 0 ? avg : limitPrice;
        cumQuote += filled * px;
        remaining = Math.max(0, remaining - filled);
      }
      if (oid) await safeCancelOrderCcxt(exchange, oid, ccxtSymbol);
    }

    await applyBinanceJitter();
    const ticker = await exchange.fetchTicker(ccxtSymbol);
    const last = Number(ticker?.last ?? 0);
    const tb = Number(ticker?.bid ?? 0);
    const ta = Number(ticker?.ask ?? 0);
    const mid = tb > 0 && ta > 0 ? (tb + ta) / 2 : last;
    const ref = Number.isFinite(mid) && mid > 0 ? mid : last;
    if (Number.isFinite(ref) && ref > 0) {
      const slipMove = adverseMoveFrac(ref);
      if (slipMove > maxSlippageFrac) {
        meta.slippage_abort_ref = ref;
        throw new Error("slippage_limit_exceeded");
      }
    }
  }

  meta.remaining_base_after_chase = remaining;
  meta.cumulative_filled_base = cumFilled;

  if (remaining > 1e-8) {
    if (String(marketRegime).toUpperCase() === "TRENDING") {
      await applyBinanceJitter();
      const ticker = await exchange.fetchTicker(ccxtSymbol);
      const last = Number(ticker?.last ?? 0);
      const tb = Number(ticker?.bid ?? 0);
      const ta = Number(ticker?.ask ?? 0);
      const mid = tb > 0 && ta > 0 ? (tb + ta) / 2 : last;
      const ref = Number.isFinite(mid) && mid > 0 ? mid : last;
      if (Number.isFinite(ref) && ref > 0 && adverseMoveFrac(ref) > maxChaseFrac) {
        meta.market_fallback_blocked_ref = ref;
        throw new Error("smart_limit_max_chase_exceeded");
      }
      const m = await createMarketOrderWithStpRetry(exchange, ccxtSymbol, side, remaining);
      execution_type = "market_fallback";
      const mf = Number((m as any)?.filled ?? remaining);
      const ma = Number((m as any)?.average ?? (m as any)?.price ?? signalPrice);
      cumFilled += mf;
      cumQuote += mf * (Number.isFinite(ma) && ma > 0 ? ma : signalPrice);
      lastOrderId = String((m as any)?.id ?? lastOrderId);
      meta.market_fallback_order = (m as any)?.id;
    } else {
      execution_type = "limit_chase_cancelled";
      meta.unfilled_remaining = remaining;
      if (cumFilled <= 1e-12) {
        throw new Error("smart_limit_no_fill_non_trending");
      }
    }
  }

  const vwap = cumFilled > 0 ? cumQuote / cumFilled : signalPrice;
  const slipPct = cumFilled > 0
    ? (side === "buy"
      ? ((vwap - signalPrice) / signalPrice) * 100
      : ((signalPrice - vwap) / signalPrice) * 100)
    : null;

  return {
    id: lastOrderId,
    status: cumFilled > 0 ? "closed" : "canceled",
    symbol,
    side,
    amount: cumFilled,
    filled: cumFilled,
    average: vwap,
    cost: cumQuote,
    price: vwap,
    execution_type,
    actual_slippage_pct: slipPct != null && Number.isFinite(slipPct)
      ? Number(slipPct.toFixed(4))
      : null,
    smart_execution_meta: meta,
  };
}

/** Alias — same as {@link executeSmartLimitChaser}. */
export const executeSmartLimitOrder = executeSmartLimitChaser;

export async function getAvailableBalance(
  symbol: string,
  exchange = getSharedBinanceSignedExchange(),
): Promise<number> {
  const ccxtSymbol = toCcxtSymbol(symbol);
  const [base] = ccxtSymbol.split("/");
  if (!base) return 0;

  await applyBinanceJitter();
  const balance = await exchange.fetchBalance();
  const free = Number(balance?.[base]?.free ?? balance?.free?.[base] ?? 0);
  return Number.isFinite(free) ? free : 0;
}

export async function getUsdtBalance(isTestMode = false): Promise<number> {
  if (isTestMode) {
    // Paper BUY sizing uses `profiles.demo_balance` via `resolvePaperWalletUsdt` in buy-prep.
    const testBalance = Number(Deno.env.get("TEST_USDT_BALANCE") ?? "100000");
    return Number.isFinite(testBalance) ? testBalance : 100000;
  }

  const exchange = getSharedBinanceSignedExchange();
  await applyBinanceJitter();
  const balance = await exchange.fetchBalance();
  const usdt = Number(balance?.USDT?.free ?? balance?.free?.USDT ?? 0);
  return Number.isFinite(usdt) ? usdt : 0;
}

export async function getTotalAccountBalanceUsdt(
  isTestMode = false,
): Promise<number> {
  if (isTestMode) {
    return getUsdtBalance(true);
  }

  const exchange = getSharedBinanceSignedExchange();
  await applyBinanceJitter();
  await exchange.loadMarkets();
  await applyBinanceJitter();
  const balance = await exchange.fetchBalance();

  const totals = (balance?.total ?? {}) as Record<string, unknown>;
  let totalUsdt = 0;

  for (const [assetRaw, amountRaw] of Object.entries(totals)) {
    const asset = String(assetRaw ?? "").toUpperCase();
    const amount = Number(amountRaw ?? 0);
    if (!asset || !Number.isFinite(amount) || amount <= 0) continue;

    if (asset === "USDT") {
      totalUsdt += amount;
      continue;
    }

    const pair = `${asset}/USDT`;
    try {
      await applyBinanceJitter();
      const ticker = await exchange.fetchTicker(pair);
      const last = Number(ticker?.last ?? 0);
      if (Number.isFinite(last) && last > 0) {
        totalUsdt += amount * last;
      }
    } catch {
      // Ignore assets without a direct USDT market to keep sync resilient.
    }
  }

  return Number.isFinite(totalUsdt) && totalUsdt > 0 ? totalUsdt : 0;
}

export type OhlcvCandle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const FETCH_OHLCV_MAX_ATTEMPTS = 4;

/** Spot OHLCV for multi-timeframe buy-flow checks (5m execution / 1h trend). */
export async function fetchCandlesOHLCV(
  symbol: string,
  timeframe: string,
  limit: number,
  signal?: AbortSignal,
): Promise<OhlcvCandle[]> {
  if (signal?.aborted) {
    throw new Error(`CYCLE_ABORTED:${symbol}`);
  }
  const exchange = getSharedBinanceSignedExchange();
  if (signal) {
    exchange.timeout = Math.min(exchange.timeout ?? 10000, 8_000);
  }
  const ccxtSymbol = toCcxtSymbol(symbol);
  await applyBinanceJitter();
  await exchange.loadMarkets();

  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_OHLCV_MAX_ATTEMPTS; attempt++) {
    try {
      await applyBinanceJitter();
      if (signal?.aborted) throw new Error(`CYCLE_ABORTED:${symbol}`);
      const raw = await exchange.fetchOHLCV(ccxtSymbol, timeframe, undefined, limit);
      const rows = Array.isArray(raw) ? raw : [];
      return rows.map((row: number[]) => ({
        ts: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      }));
    } catch (e) {
      lastErr = e;
      const retryable = isLikelyCcxtRateLimitError(e) && attempt < FETCH_OHLCV_MAX_ATTEMPTS - 1;
      if (!retryable) throw e;
      console.warn(
        `[fetchCandlesOHLCV] rate_limit_retry symbol=${symbol} tf=${timeframe} attempt=${attempt + 1}/${FETCH_OHLCV_MAX_ATTEMPTS}`,
      );
      await sleepRateLimitBackoff(e, attempt);
    }
  }
  throw lastErr ?? new Error("fetchCandlesOHLCV: exhausted retries");
}

/**
 * Classic EMA on close: seed with SMA of first `period` bars, then recursive EMA.
 * Returns null if not enough data.
 */
export function computeEmaLastFromCloses(
  closes: number[],
  period: number,
): number | null {
  const c = closes.filter((x) => Number.isFinite(x));
  if (c.length < period + 1) return null;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += c[i];
  let ema = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < c.length; i++) {
    ema = c[i] * k + ema * (1 - k);
  }
  return ema;
}
