// @ts-nocheck
/** Dynamic regime switcher: sideways grinder vs trending defensive gates (no throws). */
import type { ConfidencePolicy } from "./confidence-policy.ts";
import { isOversoldBounceStrategyReason } from "./strategy-oversold-bounce.ts";
import type { AiAnalysis, IndicatorSnapshot, SignalDecision } from "./types.ts";
import { toNumber } from "./utils.ts";

export type DynamicTradingRegime = "REGIME_SIDEWAYS" | "REGIME_TRENDING";

export type DynamicRegimeDiagnostics = {
  regime: DynamicTradingRegime;
  adx14: number;
  bbWidth: number;
  atrRatio: number;
  telemetry: string;
};

export type RegimeGatePolicy = {
  regime: DynamicTradingRegime;
  ema200Required: boolean;
  /** Sideways: allow entries with RSI below this (relaxed vs deep oversold). */
  rsiEntryMax: number;
  rsiPreflightUpper: number;
  rsiPreflightLower: number;
  minAiConfidenceFloor: number;
  /** Max weighted / hybrid conviction floor % in REGIME_TRENDING (lowers strict trade-regime caps). */
  minWeightedConvictionFloor: number;
  /** Minimum 24h quote volume for trending volume-track gate (below legacy 500k). */
  minVolume24hQuoteUsd: number;
  requireMacdHistogramExpansion: boolean;
  requireVolume24hTrack: boolean;
  /** Tight TP % for sideways grinder (null = use bot_settings). */
  grinderTakeProfitPct: number | null;
};

export function readDynamicRegimeEnabled(): boolean {
  const raw = String(Deno.env.get("DYNAMIC_REGIME_SWITCHER") ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

/** When AI confidence is at/above this, trending defensive skips MACD-flat / below-EMA200 blocks. */
export function readTrendingDefensiveAiOverrideConfidence(): number {
  const raw = String(
    Deno.env.get("TRENDING_DEFENSIVE_AI_OVERRIDE_CONF") ??
      Deno.env.get("HIGH_AI_CONF_TRENDING_OVERRIDE") ??
      "80",
  ).trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) return 80;
  return Math.min(95, Math.max(55, Math.floor(n)));
}

export function trendingDefensiveAiOverridesTechnicalGates(aiConfidence: number | undefined): boolean {
  const conf = Number(aiConfidence ?? 0);
  if (!Number.isFinite(conf)) return false;
  return conf >= readTrendingDefensiveAiOverrideConfidence();
}

function readEnvNum(key: string, fallback: number, min: number, max: number): number {
  const n = Number(Deno.env.get(key) ?? "");
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function estimateBbWidthFromSnapshot(snapshot: IndicatorSnapshot): number {
  const mid = toNumber(snapshot.bbMiddle, 0);
  const upper = toNumber(snapshot.bbUpper, 0);
  const lower = toNumber(snapshot.bbLower, 0);
  if (mid > 0 && upper > lower) {
    return Number(((upper - lower) / mid).toFixed(6));
  }
  return 0;
}

/** Classify tape into sideways grind vs trending defensive using ADX, BB width, ATR%. */
export function detectDynamicTradingRegime(
  snapshot: IndicatorSnapshot | null | undefined,
): DynamicRegimeDiagnostics {
  const empty: DynamicRegimeDiagnostics = {
    regime: "REGIME_TRENDING",
    adx14: 0,
    bbWidth: 0,
    atrRatio: 0,
    telemetry: "dyn_regime=REGIME_TRENDING|reason=missing_snapshot",
  };
  if (!snapshot || typeof snapshot !== "object") return empty;

  const adx14 = toNumber(snapshot.adx14, 0);
  const px = toNumber(snapshot.latestPrice, 0);
  const atr = toNumber(snapshot.atr14, 0);
  const atrRatio = px > 0 && atr > 0 ? atr / px : 0;
  const bbWidth = estimateBbWidthFromSnapshot(snapshot);
  const marketRegime = String(snapshot.marketRegime ?? "NEUTRAL");

  const adxTrend = readEnvNum("DYNAMIC_REGIME_ADX_TREND", 22, 10, 50);
  const adxSide = readEnvNum("DYNAMIC_REGIME_ADX_SIDEWAYS", 20, 5, 40);
  const bbSideMax = readEnvNum("DYNAMIC_REGIME_BB_WIDTH_SIDEWAYS", 0.035, 0.01, 0.15);
  const atrTrendMin = readEnvNum("DYNAMIC_REGIME_ATR_RATIO_TREND", 0.004, 0.001, 0.02);

  let regime: DynamicTradingRegime = "REGIME_TRENDING";
  let reason = "default_trending";

  if (
    marketRegime === "TRENDING" ||
    adx14 >= adxTrend ||
    atrRatio >= atrTrendMin
  ) {
    regime = "REGIME_TRENDING";
    reason = "adx_or_atr_trending";
  } else if (
    adx14 < adxSide &&
    (marketRegime === "RANGING" || marketRegime === "NEUTRAL") &&
    (bbWidth <= bbSideMax || bbWidth === 0)
  ) {
    regime = "REGIME_SIDEWAYS";
    reason = "low_adx_tight_bb";
  } else if (adx14 < adxTrend) {
    regime = "REGIME_SIDEWAYS";
    reason = "weak_adx_consolidation";
  }

  if (!readDynamicRegimeEnabled()) {
    regime = marketRegime === "TRENDING" ? "REGIME_TRENDING" : "REGIME_SIDEWAYS";
    reason = "switcher_disabled_legacy_map";
  }

  return {
    regime,
    adx14,
    bbWidth,
    atrRatio,
    telemetry:
      `dyn_regime=${regime}|reason=${reason}|adx=${adx14.toFixed(1)}|bbw=${bbWidth.toFixed(4)}|atr_pct=${(atrRatio * 100).toFixed(3)}`,
  };
}

export function readRegimeTrendingWeightedFloor(): number {
  return readEnvNum("REGIME_TRENDING_WEIGHTED_FLOOR", 55, 45, 70);
}

export function resolveRegimeGatePolicy(
  regime: DynamicTradingRegime,
): RegimeGatePolicy {
  const grinderTp = readEnvNum("REGIME_SIDEWAYS_GRINDER_TP_PCT", 1.0, 0.8, 1.2);
  const sidewaysRsiMax = readEnvNum("REGIME_SIDEWAYS_RSI_ENTRY_MAX", 55, 35, 65);
  const trendingWeightedFloor = readRegimeTrendingWeightedFloor();
  const trendingAiFloor = readEnvNum(
    "REGIME_TRENDING_MIN_AI_CONF",
    trendingWeightedFloor,
    45,
    85,
  );
  const trendingMinVolQuote = readEnvNum(
    "REGIME_TRENDING_MIN_VOLUME_24H_QUOTE",
    100_000,
    25_000,
    500_000,
  );

  if (regime === "REGIME_SIDEWAYS") {
    return {
      regime,
      ema200Required: false,
      rsiEntryMax: sidewaysRsiMax,
      rsiPreflightUpper: 58,
      rsiPreflightLower: 24,
      minAiConfidenceFloor: readEnvNum("REGIME_SIDEWAYS_MIN_AI_CONF", 52, 45, 70),
      minWeightedConvictionFloor: readEnvNum("REGIME_SIDEWAYS_WEIGHTED_FLOOR", 52, 45, 70),
      minVolume24hQuoteUsd: 0,
      requireMacdHistogramExpansion: false,
      requireVolume24hTrack: false,
      grinderTakeProfitPct: grinderTp,
    };
  }
  return {
    regime,
    ema200Required: true,
    rsiEntryMax: readEnvNum("REGIME_TRENDING_RSI_ENTRY_MAX", 60, 35, 70),
    rsiPreflightUpper: 70,
    rsiPreflightLower: 28,
    minAiConfidenceFloor: trendingAiFloor,
    minWeightedConvictionFloor: trendingWeightedFloor,
    minVolume24hQuoteUsd: trendingMinVolQuote,
    requireMacdHistogramExpansion: true,
    requireVolume24hTrack: true,
    grinderTakeProfitPct: null,
  };
}

/** Lower execution / war-room floors when dynamic regime is trending (e.g. 55 vs 70+). */
export function tuneConfidencePolicyForRegimeGate(
  policy: ConfidencePolicy,
  gate: RegimeGatePolicy,
): ConfidencePolicy {
  if (gate.regime !== "REGIME_TRENDING") return policy;
  const cap = gate.minWeightedConvictionFloor;
  return {
    ...policy,
    hybrid_min_ai_confidence: Math.min(policy.hybrid_min_ai_confidence, cap),
    grinder_weighted_floor: Math.min(policy.grinder_weighted_floor, cap),
    trade_regime_weighted_floor: Math.min(policy.trade_regime_weighted_floor, cap),
    execution_weighted_floor: Math.min(policy.execution_weighted_floor, cap),
    war_room_base_floor: Math.min(policy.war_room_base_floor, cap),
  };
}

/** After composite min-AI math, cap required confidence in trending regime. */
export function capMinAiConfidenceForTrendingRegime(
  minAiConfidence: number,
  gate: RegimeGatePolicy,
): number {
  if (gate.regime !== "REGIME_TRENDING") return minAiConfidence;
  return Math.min(minAiConfidence, gate.minWeightedConvictionFloor);
}

export function resolveMacdHistogram(snapshot: IndicatorSnapshot): number {
  const macdRaw = snapshot.macd;
  if (macdRaw != null && typeof macdRaw === "object") {
    const h = toNumber((macdRaw as { histogram?: number }).histogram, NaN);
    if (Number.isFinite(h)) return h;
    const line = toNumber((macdRaw as { macd?: number }).macd, NaN);
    const sig = toNumber((macdRaw as { signal?: number }).signal, NaN);
    if (Number.isFinite(line) && Number.isFinite(sig)) return line - sig;
  }
  if (typeof macdRaw === "number" && Number.isFinite(macdRaw)) {
    return macdRaw - toNumber(snapshot.emaSlow, 0);
  }
  return 0;
}

export function macdHistogramExpanding(snapshot: IndicatorSnapshot): boolean {
  const hist = resolveMacdHistogram(snapshot);
  const fast = toNumber(snapshot.emaFast, 0);
  const slow = toNumber(snapshot.emaSlow, 0);
  return hist > 0 && fast > slow * 0.998;
}

export function passesVolume24hTrack(
  snapshot: IndicatorSnapshot,
  minQuoteUsd = 500_000,
): boolean {
  const quote = toNumber(snapshot.volume24hQuote, 0);
  const floor = Math.max(0, Number(minQuoteUsd) || 0);
  if (floor <= 0 || quote >= floor) return true;
  const avg1m = toNumber(snapshot.avgVolume1m, 0);
  const c5 = snapshot.candles5 ?? [];
  const lastVol = toNumber(c5.at(-1)?.volume, 0);
  return avg1m > 0 && lastVol >= avg1m * 0.85;
}

export function passesRegimeEma200Gate(params: {
  policy: RegimeGatePolicy;
  snapshot: IndicatorSnapshot;
  strategySignal?: SignalDecision;
  ema200RecoveryOk?: boolean;
  hybridMomentumBypass?: boolean;
}): boolean {
  if (!params.policy.ema200Required) {
    return params.strategySignal === "BUY" || params.ema200RecoveryOk === true;
  }
  if (params.hybridMomentumBypass) return true;
  if (params.ema200RecoveryOk) return true;
  const px = toNumber(params.snapshot.latestPrice, 0);
  const ema200 = toNumber(params.snapshot.ema200, 0);
  return px > 0 && ema200 > 0 && px >= ema200 * 0.998;
}

export function passesRegimePreflightRsi(params: {
  policy: RegimeGatePolicy;
  rsi: number;
  strategySignal: SignalDecision;
  technicalScore: number;
  aiConfidence?: number;
}): { ok: boolean; failCode: string } {
  let upper = params.policy.rsiPreflightUpper;
  let lower = params.policy.rsiPreflightLower;
  const conf = Number(params.aiConfidence ?? 0);
  if (
    params.policy.regime === "REGIME_SIDEWAYS" &&
    params.strategySignal === "BUY" &&
    Number.isFinite(conf) &&
    conf >= params.policy.minAiConfidenceFloor
  ) {
    upper = Math.max(upper, 62);
  }
  if (params.technicalScore >= 8 && params.strategySignal === "BUY") {
    upper = Math.max(upper, 75);
  }
  const ok = params.rsi < upper && params.rsi > lower;
  let failCode = "FAIL_RSI_BAND";
  if (params.rsi >= upper) failCode = "FAIL_RSI_OVERBOUGHT";
  else if (params.rsi <= lower) failCode = "FAIL_RSI_OVERSOLD";
  return { ok, failCode };
}

export function evaluateTrendingDefensiveGates(params: {
  policy: RegimeGatePolicy;
  snapshot: IndicatorSnapshot;
  strategySignal: SignalDecision;
  /** Ultra-high AI conviction can skip MACD-flat and below-EMA200 blocks (volume gate still applies). */
  aiConfidence?: number;
  /** Rubber-band bounce: skip MACD-flat at capitulation lows. */
  strategyReason?: string | null;
}): { ok: boolean; failCodes: string[]; aiOverrideApplied?: boolean } {
  const fails: string[] = [];
  if (params.policy.regime !== "REGIME_TRENDING" || params.strategySignal !== "BUY") {
    return { ok: true, failCodes: fails };
  }
  const oversoldBounceStrategy = isOversoldBounceStrategyReason(params.strategyReason);
  const aiOverride = trendingDefensiveAiOverridesTechnicalGates(params.aiConfidence);
  if (
    params.policy.requireMacdHistogramExpansion &&
    !aiOverride &&
    !oversoldBounceStrategy &&
    !macdHistogramExpanding(params.snapshot)
  ) {
    fails.push("FAIL_MACD_HIST_FLAT");
  }
  if (
    params.policy.requireVolume24hTrack &&
    !passesVolume24hTrack(params.snapshot, params.policy.minVolume24hQuoteUsd)
  ) {
    fails.push("FAIL_TRENDING_VOLUME_TRACK");
  }
  const px = toNumber(params.snapshot.latestPrice, 0);
  const ema200 = toNumber(params.snapshot.ema200, 0);
  if (
    !aiOverride &&
    !oversoldBounceStrategy &&
    params.policy.ema200Required &&
    px > 0 &&
    ema200 > 0 &&
    px < ema200 * 0.998
  ) {
    fails.push("FAIL_EMA200");
  }
  return {
    ok: fails.length === 0,
    failCodes: fails,
    aiOverrideApplied: aiOverride && fails.length === 0,
  };
}

export function resolveGrinderTakeProfitPct(params: {
  policy: RegimeGatePolicy;
  strategyReason?: string | null;
  decision?: SignalDecision;
}): number | null {
  if (params.decision !== "BUY" || params.policy.regime !== "REGIME_SIDEWAYS") return null;
  return params.policy.grinderTakeProfitPct ?? null;
}

export function aiBiasSupportsSidewaysGrinder(ai: AiAnalysis | null | undefined): boolean {
  if (!ai || typeof ai !== "object") return false;
  const trend = String(ai.trend ?? "neutral").toLowerCase();
  const action = String(ai.action ?? "HOLD").toUpperCase();
  if (trend === "bearish" || action === "SELL") return false;
  return trend === "bullish" || action === "BUY" || trend === "neutral";
}

export function trySidewaysGrinderEntry(
  snapshot: IndicatorSnapshot,
  policy: RegimeGatePolicy,
): { signal: "BUY"; strategy_reason: "strategy_sideways_grinder_entry" } | null {
  if (!readDynamicRegimeEnabled() || policy.regime !== "REGIME_SIDEWAYS") return null;
  const rsi = toNumber(snapshot.rsi, 50);
  if (!(rsi > 0 && rsi < policy.rsiEntryMax)) return null;

  const nearLowerBb =
    toNumber(snapshot.bbLower, 0) > 0 &&
    toNumber(snapshot.latestPrice, 0) <= toNumber(snapshot.bbLower, 0) * 1.025;
  const softDip = rsi < policy.rsiEntryMax && (nearLowerBb || rsi < policy.rsiEntryMax - 4);
  if (!softDip) return null;

  const fast = toNumber(snapshot.emaFast, 0);
  const slow = toNumber(snapshot.emaSlow, 0);
  if (!(fast > 0 && slow > 0 && fast >= slow * 0.992)) return null;

  return { signal: "BUY", strategy_reason: "strategy_sideways_grinder_entry" };
}

export function appendRegimeTelemetry(
  strategyNotes: string,
  diagnostics: DynamicRegimeDiagnostics,
): string {
  const base = String(strategyNotes ?? "").trim();
  const tag = diagnostics.telemetry;
  if (!tag) return base;
  return base.includes("dyn_regime=") ? base : (base ? `${base}|${tag}` : tag);
}
