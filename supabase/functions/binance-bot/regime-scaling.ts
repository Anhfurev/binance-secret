// @ts-nocheck
import { toNumber } from "./utils.ts";
import { resolveRegimeMinAiConfidenceFromPolicy } from "./confidence-policy.ts";
import { TRADING_POLICY, type TradeRegimeKey } from "./config/trading-policy.ts";

export const TRADE_REGIMES = ["STABLE", "VOLATILE", "CHAOS"] as const;
export type TradeRegime = TradeRegimeKey;

export type RegimeScalingFloors = {
  minAiConfidence: number;
  maxSpreadBps: number;
  minVolume1mQuoteUsd: number;
};

const STABLE_SYMBOL_MARKERS = ["BTC", "ETH"];
const VOLATILE_SYMBOL_MARKERS = ["SOL", "ALT"];
const CHAOS_SYMBOL_MARKERS = ["PEPE", "MEME", "DOGE", "SHIB", "WIF", "BONK"];

export function resolveRegimeScalingFloors(regime: TradeRegime): RegimeScalingFloors {
  return TRADING_POLICY.confidence.tradeRegimeFloors[regime];
}

function inferTradeRegimeFromAtrRatio(atrRatio: number): TradeRegime {
  if (atrRatio < 0.002) return "STABLE";
  if (atrRatio < 0.006) return "VOLATILE";
  return "CHAOS";
}

export function resolveTradeRegime(
  symbol: string,
  latestPrice?: number,
  atr14?: number,
): TradeRegime {
  const sym = String(symbol ?? "").toUpperCase();
  if (CHAOS_SYMBOL_MARKERS.some((marker) => sym.includes(marker))) return "CHAOS";
  if (STABLE_SYMBOL_MARKERS.some((marker) => sym.includes(marker))) return "STABLE";
  if (VOLATILE_SYMBOL_MARKERS.some((marker) => sym.includes(marker))) return "VOLATILE";

  const price = toNumber(latestPrice, 0);
  const atr = toNumber(atr14, 0);
  if (price > 0 && atr > 0) {
    return inferTradeRegimeFromAtrRatio(atr / price);
  }
  return "VOLATILE";
}

export function resolveRegimeMinAiConfidence(
  row: Record<string, unknown>,
  marketRegime: string,
  tradeRegime: TradeRegime,
  _resolveBaseMinAi: (row: Record<string, unknown>, marketRegime: string) => number,
): number {
  return resolveRegimeMinAiConfidenceFromPolicy(row, marketRegime, tradeRegime);
}

export function resolveRegimeMaxSpreadBps(
  symbol: string,
  tradeRegime: TradeRegime,
): number {
  const sym = String(symbol ?? "").toUpperCase();
  const perSymbol = String(Deno.env.get(`SMART_FILTER_MAX_SPREAD_BPS_${sym}`) ?? "").trim();
  const perSymbolN = perSymbol.length ? Number(perSymbol) : NaN;
  if (Number.isFinite(perSymbolN)) {
    return Math.min(500, Math.max(1, Math.floor(perSymbolN)));
  }
  const raw = String(Deno.env.get("SMART_FILTER_MAX_SPREAD_BPS") ?? "").trim();
  const n = raw.length ? Number(raw) : NaN;
  if (Number.isFinite(n)) {
    return Math.min(500, Math.max(1, Math.floor(n)));
  }
  return resolveRegimeScalingFloors(tradeRegime).maxSpreadBps;
}

export function readStopStreakBlacklistStops(): number {
  const raw = String(Deno.env.get("STOP_STREAK_BLACKLIST_STOPS") ?? "3").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 2) return 3;
  return Math.min(6, Math.floor(n));
}

export function readStopStreakBlacklistWindowMs(): number {
  const raw = String(Deno.env.get("STOP_STREAK_BLACKLIST_WINDOW_MS") ?? "").trim();
  if (raw.length) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 60_000) {
      return Math.min(24 * 60 * 60 * 1000, Math.floor(n));
    }
  }
  return 6 * 60 * 60 * 1000;
}

export function readStopStreakBlacklistDurationMs(): number {
  const raw = String(Deno.env.get("STOP_STREAK_BLACKLIST_DURATION_MS") ?? "").trim();
  if (raw.length) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 60_000) {
      return Math.min(48 * 60 * 60 * 1000, Math.floor(n));
    }
  }
  return 12 * 60 * 60 * 1000;
}
