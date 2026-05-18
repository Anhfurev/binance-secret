// @ts-nocheck
import { MIN_TRADE_USD } from "./constants.ts";

export function readSymbolMinTradeUsd(symbol: string): number {
  const sym = String(symbol ?? "").toUpperCase();
  if (sym.includes("BTC")) {
    const raw = Number(String(Deno.env.get("MIN_TRADE_USD_BTC") ?? "50").trim());
    return Number.isFinite(raw) && raw > 0 ? Math.max(MIN_TRADE_USD, raw) : 50;
  }
  if (sym.includes("PEPE")) {
    const raw = Number(String(Deno.env.get("MIN_TRADE_USD_PEPE") ?? "25").trim());
    return Number.isFinite(raw) && raw > 0 ? Math.max(MIN_TRADE_USD, raw) : 25;
  }
  const raw = Number(String(Deno.env.get("MIN_TRADE_USD_DEFAULT") ?? String(MIN_TRADE_USD)).trim());
  return Number.isFinite(raw) && raw > 0 ? Math.max(MIN_TRADE_USD, raw) : MIN_TRADE_USD;
}

export function applySymbolTradeUsdFloor(params: {
  symbol: string;
  tradeUsd: number;
  currentBalance: number;
}): number {
  const floor = readSymbolMinTradeUsd(params.symbol);
  const tradeUsd = Math.max(0, Number(params.tradeUsd));
  const balance = Math.max(0, Number(params.currentBalance));
  const target = Math.max(floor, tradeUsd);
  if (balance <= 0) {
    return Number(target.toFixed(2));
  }
  return Number(Math.min(balance, target).toFixed(2));
}
