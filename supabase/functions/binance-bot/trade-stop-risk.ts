// @ts-nocheck
import type { OpenTradeRow } from "./types.ts";
import { clamp, toNumber } from "./utils.ts";

/** Floor stop width (%) by symbol. */
export function readMinStopLossPct(symbol: string): number {
  const sym = String(symbol ?? "").toUpperCase();
  if (/PEPE|BONK|WIF|FLOKI|MEME/.test(sym)) return 3.5;
  if (sym.includes("SOL")) return 1.5;
  if (sym.includes("BTC")) return 1.0;
  return 1.0;
}

export function resolveStopLossPctFraction(
  rowStopLossPct: number,
  symbol: string,
): number {
  const dbPct = clamp(toNumber(rowStopLossPct, 2), 0.1, 50) / 100;
  const floorPct = readMinStopLossPct(symbol) / 100;
  return Math.max(dbPct, floorPct);
}

/** TP must be at least 2× effective stop (percent points). */
export function resolveTakeProfitPctPoints(
  rowTakeProfitPct: number,
  rowStopLossPct: number,
  symbol: string,
): number {
  const stopPoints = resolveStopLossPctFraction(rowStopLossPct, symbol) * 100;
  const dbTp = clamp(toNumber(rowTakeProfitPct, 4), 0.1, 100);
  return Math.max(dbTp, stopPoints * 2);
}

export function readTradeStopLossPrice(openTrade: OpenTradeRow): number {
  const raw = openTrade.stopLoss ?? (openTrade as Record<string, unknown>)["stopLoss"];
  return toNumber(raw, NaN);
}

export function hasDbStopLossPrice(openTrade: OpenTradeRow): boolean {
  const sl = readTradeStopLossPrice(openTrade);
  return Number.isFinite(sl) && sl > 0;
}

export function resolveHardStopLossFrac(
  openTrade: OpenTradeRow,
  entry: number,
  fallbackFrac: number,
): number {
  const sl = readTradeStopLossPrice(openTrade);
  if (Number.isFinite(sl) && sl > 0 && entry > 0 && sl < entry) {
    return (entry - sl) / entry;
  }
  return fallbackFrac;
}
