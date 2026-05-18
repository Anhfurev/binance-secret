// @ts-nocheck
/** Pure math for fast-lane USDT-M sizing — no I/O (sub-ms). */

import type { BotGlobalSettingsRow } from "./bot-global-settings.ts";
import { readFastBounceAccountUsd } from "./bot-global-settings.ts";
import {
  floorQtyToLotStep,
  safeDivideNotionalByPrice,
} from "./buy-live-wallet-sizing.ts";

export const BTC_FUTURES_MIN_NOTIONAL_USD = 51;
export const ALT_FUTURES_MIN_NOTIONAL_USD = 5.5;

export function toFuturesUsdtSymbol(symbol: string): string {
  const s = String(symbol ?? "").toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

/** Binance USDT-M lot step: BTC/SOL 3 dp (0.001); PEPE integer. */
export function resolveFuturesLotStep(symbol: string): number {
  const sym = toFuturesUsdtSymbol(symbol);
  if (sym.includes("PEPE") || sym.includes("SHIB") || sym.includes("BONK") || sym.includes("FLOKI")) {
    return 1;
  }
  if (sym.includes("BTC") || sym.includes("SOL")) {
    return 0.001;
  }
  return 0.001;
}

export function computeFastLaneNotionalUsd(
  symbol: string,
  global: BotGlobalSettingsRow,
  accountUsd = readFastBounceAccountUsd(),
): number {
  const baseUsd = Number(accountUsd);
  const leverage = Math.min(
    50,
    Math.max(1, Math.floor(Number(global.allowed_leverage ?? 10))),
  );
  const multiplier = Number(global.global_trade_multiplier ?? 1);
  let notionalSize = baseUsd * 0.15 * leverage * multiplier;

  const sym = toFuturesUsdtSymbol(symbol);
  if (sym === "BTCUSDT" && notionalSize < BTC_FUTURES_MIN_NOTIONAL_USD) {
    notionalSize = BTC_FUTURES_MIN_NOTIONAL_USD;
  } else if (sym !== "BTCUSDT" && notionalSize < ALT_FUTURES_MIN_NOTIONAL_USD) {
    notionalSize = ALT_FUTURES_MIN_NOTIONAL_USD;
  }

  return Number(notionalSize.toFixed(4));
}

export function computeFastLaneFuturesQty(
  symbol: string,
  notionalUsd: number,
  referencePrice: number,
): number {
  const px = Number(referencePrice);
  const cap = Number(notionalUsd);
  if (!(px > 0) || !(cap > 0)) return 0;

  const rawQty = safeDivideNotionalByPrice(cap, px);
  if (!(rawQty > 0)) return 0;

  const sym = toFuturesUsdtSymbol(symbol);
  const step = resolveFuturesLotStep(sym);
  let qty = floorQtyToLotStep({
    qty: rawQty,
    stepSize: step,
    tradeUsd: cap,
    referencePrice: px,
  });

  const minNotional = sym === "BTCUSDT"
    ? BTC_FUTURES_MIN_NOTIONAL_USD
    : ALT_FUTURES_MIN_NOTIONAL_USD;
  if (qty * px < minNotional - 1e-6) {
    const minRaw = safeDivideNotionalByPrice(minNotional, px);
    const steps = step >= 1
      ? Math.ceil(minRaw / step - 1e-12)
      : Math.ceil(minRaw / step - 1e-12);
    qty = steps * step;
    if (step < 1) {
      const decimals = String(step).includes(".")
        ? (String(step).split(".")[1] ?? "").length
        : 0;
      qty = Number(qty.toFixed(Math.min(8, decimals)));
    }
  }

  return qty > 0 && Number.isFinite(qty) ? qty : 0;
}
