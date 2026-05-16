// @ts-nocheck
/** Regime-aware relaxations: EMA200 momentum, adaptive RSI, micro-cap volume scaling. */
import type { IndicatorSnapshot, SignalDecision } from "./types.ts";
import { resolveTradeRegime, type TradeRegime } from "./regime-scaling.ts";
import { toNumber } from "./utils.ts";
import type { RegimeGatePolicy } from "./dynamic-regime-switcher.ts";
import { readDynamicRegimeEnabled } from "./dynamic-regime-switcher.ts";

const MICRO_CAP_MARKERS = ["PEPE", "MEME", "DOGE", "SHIB", "WIF", "BONK", "FLOKI"];

const MOMENTUM_STRATEGY_REASONS = new Set([
  "strategy_trend_momentum_entry",
  "strategy_trend_grind_entry",
  "strategy_structure_recovery_entry",
  "strategy_hybrid_neutral_momentum_entry",
  "strategy_hybrid_breakout_entry",
]);

export function readHybridGatesEnabled(): boolean {
  const raw = String(Deno.env.get("STRATEGY_HYBRID_GATES") ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export function readAdaptiveRsiMinAiConfidence(): number {
  const n = Number(Deno.env.get("STRATEGY_ADAPTIVE_RSI_MIN_AI") ?? "65");
  if (!Number.isFinite(n)) return 65;
  return Math.min(90, Math.max(55, Math.floor(n)));
}

export function readAdaptiveRsiNeutralMax(): number {
  const n = Number(Deno.env.get("STRATEGY_ADAPTIVE_RSI_NEUTRAL_MAX") ?? "62");
  if (!Number.isFinite(n)) return 62;
  return Math.min(72, Math.max(50, Math.floor(n)));
}

export function isMicroCapSymbol(symbol: string): boolean {
  const sym = String(symbol ?? "").toUpperCase();
  return MICRO_CAP_MARKERS.some((m) => sym.includes(m));
}

export function isTrendingOrBullishSnapshot(snapshot: IndicatorSnapshot): boolean {
  if (!readHybridGatesEnabled()) return false;
  if (snapshot.marketRegime === "TRENDING") return true;
  if (Number(snapshot.adx14) >= 22) return true;
  const th = snapshot.trend_htf;
  if (th?.trend_1h === "bull" || th?.trend_4h === "bull") return true;
  if (th?.trend_15m === "bull" && th?.mtf_effective_ok) return true;
  return false;
}

export function isLowVolatilityQuiet(snapshot: IndicatorSnapshot): boolean {
  const px = toNumber(snapshot.latestPrice, 0);
  const atr = toNumber(snapshot.atr14, 0);
  const atrRatio = px > 0 && atr > 0 ? atr / px : 0;
  if (atrRatio > 0 && atrRatio < 0.0025) return true;
  const avg1m = toNumber(snapshot.avgVolume1m, 0);
  const base24h = toNumber(snapshot.volume24hBase, 0);
  const avgFrom24h = base24h > 0 ? base24h / 1440 : 0;
  if (avgFrom24h > 0 && avg1m > 0 && avg1m < avgFrom24h * 0.45) return true;
  return false;
}

export function allowsEma200HybridBypass(params: {
  snapshot: IndicatorSnapshot;
  strategySignal?: SignalDecision;
  strategyReason?: string | null;
  technicalScore?: number;
  aiConfidence?: number;
  gatePolicy?: RegimeGatePolicy | null;
}): boolean {
  if (!readHybridGatesEnabled() && !readDynamicRegimeEnabled()) return false;
  if (
    readDynamicRegimeEnabled() &&
    params.gatePolicy &&
    !params.gatePolicy.ema200Required &&
    params.strategySignal === "BUY"
  ) {
    return true;
  }
  if (!readHybridGatesEnabled()) return false;
  if (params.strategySignal !== "BUY") return false;
  if (!isTrendingOrBullishSnapshot(params.snapshot)) return false;

  const reason = String(params.strategyReason ?? "");
  if (MOMENTUM_STRATEGY_REASONS.has(reason)) return true;

  const tech = Number(params.technicalScore ?? 0);
  const conf = Number(params.aiConfidence ?? 0);
  const px = params.snapshot.latestPrice;
  const ema200 = params.snapshot.ema200;
  const ema50 = Number(params.snapshot.ema50) > 0
    ? params.snapshot.ema50
    : params.snapshot.emaSlow;
  const below200 = px > 0 && ema200 > 0 && px < ema200;
  const near50 = px >= ema50 * 0.985;
  const fastAboveSlow = params.snapshot.emaFast > params.snapshot.emaSlow * 0.998;

  if (below200 && near50 && fastAboveSlow && tech >= 6) return true;
  if (
    conf >= readAdaptiveRsiMinAiConfidence() &&
    fastAboveSlow &&
    (near50 || px >= ema200 * 0.998)
  ) {
    return true;
  }
  return false;
}

export function resolveAdaptivePreflightRsiBounds(params: {
  rsi: number;
  strategySignal: SignalDecision;
  technicalScore: number;
  aiConfidence?: number;
  buyRsiMax?: number;
}): { ok: boolean; upperBound: number; lowerBound: number; failCode: string } {
  const conf = Number(params.aiConfidence ?? 0);
  const buyMax = Number.isFinite(Number(params.buyRsiMax))
    ? Number(params.buyRsiMax)
    : 53;
  let upperBound = params.technicalScore >= 8 && params.strategySignal === "BUY" ? 75 : 70;
  let lowerBound = params.strategySignal === "BUY" ? 22 : 28;

  if (
    readHybridGatesEnabled() &&
    params.strategySignal === "BUY" &&
    Number.isFinite(conf) &&
    conf >= readAdaptiveRsiMinAiConfidence()
  ) {
    upperBound = Math.max(upperBound, readAdaptiveRsiNeutralMax(), buyMax + 12);
    lowerBound = Math.min(lowerBound, 26);
  }

  const ok = params.rsi < upperBound && params.rsi > lowerBound;
  let failCode = "FAIL_RSI_BAND";
  if (params.rsi >= upperBound) failCode = "FAIL_RSI_OVERBOUGHT";
  else if (params.rsi <= lowerBound) failCode = "FAIL_RSI_OVERSOLD";
  return { ok, upperBound, lowerBound, failCode };
}

/** High-AI neutral-zone entries (RSI above strict oversold, e.g. 51–56). */
export function allowsAdaptiveNeutralRsiBuy(params: {
  rsi: number;
  aiConfidence: number;
  strategyBuyRsiThreshold: number;
  marketRegime: string;
  strategySignal: SignalDecision;
}): boolean {
  if (!readHybridGatesEnabled() || params.strategySignal !== "BUY") return false;
  const conf = Number(params.aiConfidence);
  if (!Number.isFinite(conf) || conf < readAdaptiveRsiMinAiConfidence()) return false;
  const rsi = Number(params.rsi);
  if (!Number.isFinite(rsi)) return false;
  if (rsi <= 28 || rsi >= 75) return false;
  if (rsi < params.strategyBuyRsiThreshold) return false;
  const neutralMax = readAdaptiveRsiNeutralMax() + 6;
  if (rsi > neutralMax) return false;
  return params.marketRegime === "TRENDING" || params.marketRegime === "NEUTRAL";
}

export function resolveScaledSmartFilterFloors(params: {
  snapshot: IndicatorSnapshot;
  tradeRegime: TradeRegime;
  baseMinVolVs24hAvg: number;
  baseMinVolume1mQuoteUsd: number;
}): {
  minVolVs24hAvg: number;
  minVolume1mQuoteUsd: number;
  quietLowVol: boolean;
  scaleApplied: number;
} {
  const quiet = isLowVolatilityQuiet(params.snapshot);
  const micro = isMicroCapSymbol(params.snapshot.symbol);
  if (!readHybridGatesEnabled() || !micro || !quiet) {
    return {
      minVolVs24hAvg: params.baseMinVolVs24hAvg,
      minVolume1mQuoteUsd: params.baseMinVolume1mQuoteUsd,
      quietLowVol: quiet,
      scaleApplied: 1,
    };
  }
  const rawScale = Number(Deno.env.get("SMART_FILTER_MICRO_CAP_VOL_SCALE") ?? "0.35");
  const scale = Number.isFinite(rawScale)
    ? Math.min(1, Math.max(0.15, rawScale))
    : 0.35;
  const regimeBump = params.tradeRegime === "CHAOS" ? 0.85 : 1;
  const effective = scale * regimeBump;
  return {
    minVolVs24hAvg: params.baseMinVolVs24hAvg * effective,
    minVolume1mQuoteUsd: Math.floor(params.baseMinVolume1mQuoteUsd * effective),
    quietLowVol: true,
    scaleApplied: effective,
  };
}
