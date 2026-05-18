// @ts-nocheck
import { getUsdtBalance } from "./binance.ts";
import { isPaperTradingEnvForced } from "./paper-trade-interceptor.ts";
import { resolvePaperSimulationLiquidityUsdt } from "./paper-balance.ts";
import { MIN_TRADE_USD } from "./constants.ts";
import { applySymbolTradeUsdFloor } from "./trade-size-floor.ts";
import { clamp } from "./utils.ts";

/** Structural micro-clip floor for rubber-band bounce (not scaled down by AI %). */
export const OVERSOLD_BOUNCE_RIGID_FLOOR_USD = 12;

export function readOversoldBounceRigidFloorUsd(): number {
  const raw = Number(Deno.env.get("OVERSOLD_BOUNCE_RIGID_FLOOR_USD") ?? "12");
  return Number.isFinite(raw) && raw >= MIN_TRADE_USD ? raw : OVERSOLD_BOUNCE_RIGID_FLOOR_USD;
}

export function readMicroAccountBalanceThresholdUsd(): number {
  const raw = Number(Deno.env.get("MICRO_ACCOUNT_BALANCE_THRESHOLD_USD") ?? "50");
  return Number.isFinite(raw) && raw > 0 ? raw : 50;
}

export function readMicroAccountClipMinUsd(): number {
  const minClip = Number(Deno.env.get("MICRO_ACCOUNT_CLIP_MIN_USD") ?? "12");
  return Number.isFinite(minClip) && minClip >= MIN_TRADE_USD ? minClip : 12;
}

export function readMicroAccountClipMaxUsd(): number {
  const maxClip = Number(Deno.env.get("MICRO_ACCOUNT_CLIP_MAX_USD") ?? "15");
  const min = readMicroAccountClipMinUsd();
  return Number.isFinite(maxClip) && maxClip >= min ? maxClip : 15;
}

/** Binance LOT_SIZE defaults when filters are unavailable (tests / offline). */
export function resolveSymbolLotStepSize(symbol: string): number {
  const sym = String(symbol ?? "").toUpperCase();
  if (sym.includes("PEPE") || sym.includes("SHIB") || sym.includes("BONK") || sym.includes("FLOKI")) {
    return 1;
  }
  if (sym.includes("SOL") && !sym.includes("PEPE")) {
    return 0.01;
  }
  if (sym.includes("BTC")) {
    return 0.00001;
  }
  return 0.0001;
}

/** Safe notional ÷ price — avoids PEPE-scale float underflow / garbage. */
export function safeDivideNotionalByPrice(tradeUsd: number, referencePrice: number): number {
  const usd = Number(tradeUsd);
  const px = Number(referencePrice);
  if (!(usd > 0) || !(px > 0) || !Number.isFinite(usd) || !Number.isFinite(px)) return 0;
  const raw = usd / px;
  if (!Number.isFinite(raw) || raw <= 0 || raw > 1e15) return 0;
  return raw;
}

function lotStepDecimalPlaces(step: number): number {
  if (!(step > 0) || step >= 1) return 0;
  const parts = String(step).split(".");
  return Math.min(8, (parts[1] ?? "").replace(/0+$/, "").length);
}

/** Floor to LOT_SIZE; if floored qty is 0, use one minimum spendable step. */
export function floorQtyToLotStep(params: {
  qty: number;
  stepSize: number;
  tradeUsd: number;
  referencePrice: number;
}): number {
  const step = Number(params.stepSize);
  const px = Number(params.referencePrice);
  const cap = Number(params.tradeUsd);
  let qty = Number(params.qty);
  if (!(qty > 0) || !(step > 0) || !Number.isFinite(step)) {
    return qty > 0 && Number.isFinite(qty) ? qty : 0;
  }

  const steps = step >= 1
    ? Math.floor(qty / step + 1e-12)
    : Math.floor(qty / step + 1e-12);
  let floored = steps * step;
  if (step < 1) {
    floored = Number(floored.toFixed(lotStepDecimalPlaces(step)));
  }

  if (!(floored > 0) && step * px <= cap + 1e-6) {
    floored = step;
  }
  return floored > 0 && Number.isFinite(floored) ? floored : 0;
}

/**
 * Pure qty helper: notional → base qty with symbol-aware lot steps (PEPE integer, SOL 0.01).
 */
export function computeBuyBaseQtyFromNotional(
  tradeUsd: number,
  referencePrice: number,
  stepSize = 0,
  symbol = "",
): number {
  const step = Number(stepSize) > 0 ? Number(stepSize) : resolveSymbolLotStepSize(symbol);
  const rawQty = safeDivideNotionalByPrice(tradeUsd, referencePrice);
  if (!(rawQty > 0)) return 0;
  return floorQtyToLotStep({
    qty: rawQty,
    stepSize: step,
    tradeUsd,
    referencePrice,
  });
}

/** Bounce path: rigid $12 floor — no down-scaling below micro-clip target. */
export function applyOversoldBounceRigidTradeUsdFloor(
  tradeUsd: number,
  liveFreeUsdt: number,
): number {
  const wallet = Math.max(0, Number(liveFreeUsdt));
  let usd = Number(tradeUsd);
  if (!Number.isFinite(usd) || usd < 0) usd = 0;
  const rigid = readOversoldBounceRigidFloorUsd();
  if (usd < rigid) usd = rigid;
  if (wallet > 0) usd = Math.min(usd, wallet);
  return Number(usd.toFixed(2));
}

/** Target notional band for micro wallets (default $12–$15). */
export function resolveMicroClipTargetUsd(liveFreeUsdt: number): number {
  const wallet = Math.max(0, liveFreeUsdt);
  const min = readMicroAccountClipMinUsd();
  const max = readMicroAccountClipMaxUsd();
  const dustReserve = 2;
  const affordable = Math.max(0, wallet - dustReserve);
  if (affordable < MIN_TRADE_USD) return Math.min(wallet, affordable);
  if (affordable >= min) {
    return clamp(Math.min(max, affordable), min, affordable);
  }
  return Math.min(wallet, Math.max(MIN_TRADE_USD, affordable));
}

/**
 * Never return 0 when wallet can fund at least MIN_TRADE_USD / micro-clip.
 * Bounce paths keep a firm executable notional instead of confidence-compressed dust.
 */
export type LiveWalletSizingResult = {
  /** Final executable notional (USDT) — canonical key for buy-context / bot-buy-v2. */
  tradeUsd: number;
  skipDetail?: string;
  liveFreeUsdt?: number;
};

/** Unify legacy / alternate payload keys from sizing helpers. */
export function normalizeLiveWalletSizingResult(
  raw: Partial<LiveWalletSizingResult> & Record<string, unknown>,
): LiveWalletSizingResult {
  const tradeUsd = Number(
    raw.tradeUsd ??
      raw.trade_usd ??
      raw.orderUsd ??
      raw.order_usd ??
      raw.notionalUsd ??
      raw.notional_usd ??
      0,
  );
  const liveRaw = raw.liveFreeUsdt ?? raw.live_free_usdt ?? raw.availableUsdt ?? raw.available_usdt;
  const liveFreeUsdt = Number(liveRaw);
  return {
    tradeUsd: Number.isFinite(tradeUsd) ? tradeUsd : 0,
    skipDetail: typeof raw.skipDetail === "string" ? raw.skipDetail : undefined,
    liveFreeUsdt: Number.isFinite(liveFreeUsdt) ? liveFreeUsdt : undefined,
  };
}

/**
 * Last-chance notional salvage before execution gates (fixes DB balance=0 vs live USDT mismatch).
 */
export function salvageTradeUsdBeforeExecution(params: {
  tradeUsd: number;
  availableBalance: number;
  oversoldBounce?: boolean;
  symbol: string;
}): number {
  const balance = Math.max(0, Number(params.availableBalance));
  const pseudoWallet = balance > 0 ? balance : readOversoldBounceRigidFloorUsd();
  let usd = Number(params.tradeUsd);
  if (!Number.isFinite(usd) || usd < 0) usd = 0;

  if (params.oversoldBounce) {
    usd = applyOversoldBounceRigidTradeUsdFloor(usd, pseudoWallet);
  }
  usd = enforceMinimumExecutableTradeUsd({
    tradeUsd: usd,
    liveFreeUsdt: balance > 0 ? balance : pseudoWallet,
    oversoldBounce: params.oversoldBounce,
  });
  if (balance > 0) {
    usd = applySymbolTradeUsdFloor({
      symbol: params.symbol,
      tradeUsd: usd,
      currentBalance: balance,
    });
  }
  if (params.oversoldBounce && usd < readOversoldBounceRigidFloorUsd()) {
    usd = applyOversoldBounceRigidTradeUsdFloor(usd, pseudoWallet);
  }
  return Number(usd.toFixed(2));
}

export function enforceMinimumExecutableTradeUsd(params: {
  tradeUsd: number;
  liveFreeUsdt: number;
  oversoldBounce?: boolean;
}): number {
  const wallet = Math.max(0, params.liveFreeUsdt);
  let tradeUsd = Number(params.tradeUsd);
  if (!Number.isFinite(tradeUsd) || tradeUsd < 0) tradeUsd = 0;

  if (params.oversoldBounce) {
    return applyOversoldBounceRigidTradeUsdFloor(
      tradeUsd,
      wallet > 0 ? wallet : readOversoldBounceRigidFloorUsd(),
    );
  }

  if (wallet <= 0) return 0;

  const microClip = resolveMicroClipTargetUsd(wallet);
  const minExec = Math.max(MIN_TRADE_USD, readMicroAccountClipMinUsd());
  const isMicroWallet = wallet < readMicroAccountBalanceThresholdUsd();

  if (tradeUsd <= 0 || tradeUsd < MIN_TRADE_USD) {
    if (wallet >= minExec) {
      tradeUsd = isMicroWallet ? microClip : Math.min(minExec, wallet);
    } else if (wallet >= MIN_TRADE_USD) {
      tradeUsd = MIN_TRADE_USD;
    } else {
      tradeUsd = Math.min(tradeUsd, wallet);
    }
  } else if (isMicroWallet && tradeUsd < microClip && wallet >= microClip) {
    tradeUsd = microClip;
  }

  if (isMicroWallet) {
    return Number(Math.min(tradeUsd, wallet).toFixed(2));
  }
  return Number(tradeUsd.toFixed(2));
}

/** Clip notional for micro wallets (default $12–$15 when free USDT is below threshold). */
export function clipTradeUsdForMicroWallet(tradeUsd: number, liveFreeUsdt: number): number {
  const wallet = Math.max(0, liveFreeUsdt);
  if (wallet >= readMicroAccountBalanceThresholdUsd()) {
    const usd = Number(tradeUsd);
    if (!Number.isFinite(usd) || usd <= 0) {
      return enforceMinimumExecutableTradeUsd({ tradeUsd: 0, liveFreeUsdt: wallet });
    }
    if (usd < MIN_TRADE_USD) {
      return enforceMinimumExecutableTradeUsd({ tradeUsd: usd, liveFreeUsdt: wallet });
    }
    return Number(usd.toFixed(2));
  }
  const clipTarget = resolveMicroClipTargetUsd(wallet);
  const clipped = Math.min(tradeUsd, clipTarget, wallet);
  return enforceMinimumExecutableTradeUsd({ tradeUsd: clipped, liveFreeUsdt: wallet });
}

/** Legacy sizing/preflight blocks that bounce re-validates via CCXT at dispatch. */
export function isLegacyDbLiveBalanceSkip(skipDetail?: string | null): boolean {
  const s = String(skipDetail ?? "");
  return s.includes("Insufficient actual live balance") ||
    s.includes("Balance too low for BUY") ||
    s.includes("Insufficient balance (reserved)");
}

export function resolveLiveBalancePreflightSkip(
  tradeUsd: number,
  liveFreeUsdt: number,
  opts?: { oversoldBounce?: boolean },
): string | null {
  if (opts?.oversoldBounce) {
    return null;
  }
  if (!(tradeUsd > 0)) return null;
  const free = Math.max(0, Number(liveFreeUsdt));
  const required = Number(tradeUsd);
  if (free >= required - 1e-6) return null;

  return (
    `BUY blocked: Insufficient actual live balance. Required: $${required.toFixed(2)}, Available: $${free.toFixed(2)}`
  );
}

/** Bounce dispatch gate: CCXT free USDT only (success when free ≥ rigid $12 floor). */
export function evaluateBounceDispatchBalanceGate(
  exchangeFreeUsdt: number,
  tradeUsd?: number,
): { success: boolean; exchangeFreeUsdt: number; skipDetail?: string } {
  const free = Math.max(0, Number(exchangeFreeUsdt));
  const rigid = readOversoldBounceRigidFloorUsd();
  const required = Math.max(rigid, Number(tradeUsd ?? rigid));
  if (free >= required - 1e-6 || free >= rigid - 1e-6) {
    return { success: true, exchangeFreeUsdt: free };
  }
  return {
    success: false,
    exchangeFreeUsdt: free,
    skipDetail: resolveOversoldBounceExecutionBalanceSkip(free, tradeUsd) ??
      `BUY blocked: bounce CCXT free USDT $${free.toFixed(2)} < $${rigid.toFixed(2)}`,
  };
}

/** Fresh CCXT free USDT for bounce dispatch (ignores DB headroom / reservations). */
export async function fetchExchangeFreeUsdtForBounce(cachedFree?: number): Promise<number> {
  const cached = Number(cachedFree);
  if (Number.isFinite(cached) && cached > 0) return cached;
  return getUsdtBalance(false);
}

/** Final gate before `createOrder` — bounce proceeds when exchange free ≥ $12 rigid floor. */
export function resolveOversoldBounceExecutionBalanceSkip(
  exchangeFreeUsdt: number,
  tradeUsd?: number,
): string | null {
  const free = Math.max(0, Number(exchangeFreeUsdt));
  const rigid = readOversoldBounceRigidFloorUsd();
  const required = Number(tradeUsd ?? rigid);
  if (free >= Math.max(rigid, required) - 1e-6) return null;
  if (free >= rigid - 1e-6) return null;
  return (
    `BUY blocked: bounce CCXT free USDT $${free.toFixed(2)} < floor $${rigid.toFixed(2)} (ignores DB headroom)`
  );
}

/** Cap micro-clip bounce notional to verified exchange free USDT (ignores DB headroom). */
export function capBounceTradeUsdToExchangeFree(
  tradeUsd: number,
  liveFreeUsdt: number,
): number {
  const free = Math.max(0, Number(liveFreeUsdt));
  let usd = applyOversoldBounceRigidTradeUsdFloor(Number(tradeUsd), free > 0 ? free : readOversoldBounceRigidFloorUsd());
  if (free > 0) usd = Math.min(usd, free);
  return Number(usd.toFixed(2));
}

/** Live-only: fetch free USDT, micro-clip, rigid bounce floor, then verify wallet. */
export async function applyLiveWalletSizingConstraints(params: {
  enabled: boolean;
  symbol: string;
  tradeUsd: number;
  currentBalance: number;
  oversoldBounce?: boolean;
}): Promise<LiveWalletSizingResult> {
  const finalize = (tradeUsd: number, liveFreeUsdt: number) => {
    let usd = Number(tradeUsd);
    if (params.oversoldBounce) {
      usd = applyOversoldBounceRigidTradeUsdFloor(usd, liveFreeUsdt);
    }
    usd = enforceMinimumExecutableTradeUsd({
      tradeUsd: usd,
      liveFreeUsdt,
      oversoldBounce: params.oversoldBounce,
    });
    return usd;
  };

  const paperEnvForced = isPaperTradingEnvForced();
  if (!params.enabled || paperEnvForced) {
    const liveFreeUsdt = paperEnvForced
      ? resolvePaperSimulationLiquidityUsdt(params.currentBalance)
      : Math.max(0, Number(params.currentBalance));
    const tradeUsd = params.oversoldBounce
      ? finalize(params.tradeUsd, liveFreeUsdt)
      : Number(params.tradeUsd);
    return normalizeLiveWalletSizingResult({ tradeUsd, liveFreeUsdt });
  }

  let liveFreeUsdt: number;
  try {
    liveFreeUsdt = await getUsdtBalance(false);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      tradeUsd: params.tradeUsd,
      skipDetail: `BUY blocked: live USDT balance fetch failed (${detail})`,
    };
  }
  if (!Number.isFinite(liveFreeUsdt) || liveFreeUsdt < 0) {
    return {
      tradeUsd: params.tradeUsd,
      skipDetail: "BUY blocked: live USDT balance unavailable",
    };
  }

  let tradeUsd = clipTradeUsdForMicroWallet(params.tradeUsd, liveFreeUsdt);
  tradeUsd = finalize(tradeUsd, liveFreeUsdt);
  tradeUsd = applySymbolTradeUsdFloor({
    symbol: params.symbol,
    tradeUsd,
    currentBalance: liveFreeUsdt,
  });
  tradeUsd = finalize(tradeUsd, liveFreeUsdt);
  if (params.oversoldBounce) {
    tradeUsd = capBounceTradeUsdToExchangeFree(tradeUsd, liveFreeUsdt);
  }

  const preflightSkip = resolveLiveBalancePreflightSkip(tradeUsd, liveFreeUsdt, {
    oversoldBounce: params.oversoldBounce,
  });
  if (preflightSkip) {
    return normalizeLiveWalletSizingResult({ tradeUsd, liveFreeUsdt, skipDetail: preflightSkip });
  }
  return normalizeLiveWalletSizingResult({ tradeUsd, liveFreeUsdt });
}
