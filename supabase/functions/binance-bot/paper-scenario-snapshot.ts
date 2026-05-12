// @ts-nocheck
import type { Candle, IndicatorSnapshot } from "./types.ts";
import type { AiAnalysis } from "./types.ts";

export const PAPER_SCENARIO_NAMES = [
  "momentum_buy",
  "oversold_buy",
  "force_paper_buy",
] as const;

export type PaperScenarioName = (typeof PAPER_SCENARIO_NAMES)[number];

export function isPaperScenarioName(value: string): value is PaperScenarioName {
  return (PAPER_SCENARIO_NAMES as readonly string[]).includes(value);
}

function candle(ts: number, close: number, volume = 1000): Candle {
  const c = Number(close.toFixed(8));
  return {
    openTime: ts,
    open: c,
    high: Number((c * 1.001).toFixed(8)),
    low: Number((c * 0.999).toFixed(8)),
    close: c,
    volume,
  };
}

function risingCandles(price: number, volume = 1000): Candle[] {
  const now = Date.now();
  const p1 = price * 0.998;
  const p2 = price * 0.999;
  const p3 = price;
  return [
    candle(now - 180_000, p1, volume),
    candle(now - 120_000, p2, volume),
    candle(now - 60_000, p3, volume),
  ];
}

function cloneCandles(candles: Candle[] | undefined): Candle[] {
  return (candles ?? []).map((row) => ({ ...row }));
}

function ensureRisingMicroTape(candles: Candle[], anchorPrice: number): Candle[] {
  const tape = candles.length >= 3 ? cloneCandles(candles) : risingCandles(anchorPrice);
  const last = tape.length - 1;
  const p3 = Number(tape[last]?.close ?? anchorPrice);
  const p2 = Number((p3 * 0.999).toFixed(8));
  const p1 = Number((p2 * 0.999).toFixed(8));
  const vol = Number(tape[last]?.volume ?? tape[0]?.volume ?? 1000);
  tape[last] = candle(Date.now() - 60_000, p3, vol);
  if (last >= 1) tape[last - 1] = candle(Date.now() - 120_000, p2, vol);
  if (last >= 2) tape[last - 2] = candle(Date.now() - 180_000, p1, vol);
  return tape;
}

function finitePositive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Overlay synthetic tape while keeping live price, volume, and book context. */
export function applyPaperScenarioOverlay(
  base: IndicatorSnapshot,
  scenario: PaperScenarioName,
): IndicatorSnapshot {
  const anchorPrice = finitePositive(base.latestPrice, 100);
  const avgVolume1m = Math.max(finitePositive(base.avgVolume1m, 0), 1000);
  const emaSlow = finitePositive(base.emaSlow, anchorPrice * 0.995);
  const emaFast = Math.max(finitePositive(base.emaFast, anchorPrice * 1.001), emaSlow * 1.0005);
  const ema50 = finitePositive(base.ema50, anchorPrice * 0.998);
  const ema200 = finitePositive(base.ema200, anchorPrice * 0.99);
  const bbMiddle = finitePositive(base.bbMiddle, anchorPrice);
  const bbLower = finitePositive(base.bbLower, bbMiddle * 0.985);
  const bbUpper = finitePositive(base.bbUpper, bbMiddle * 1.015);
  const candles5 = ensureRisingMicroTape(cloneCandles(base.candles5), anchorPrice);
  if (candles5.length > 0) {
    const last = candles5.length - 1;
    const lastVol = Number(candles5[last]?.volume ?? 0);
    if (!(lastVol > avgVolume1m * 1.2)) {
      candles5[last] = {
        ...candles5[last],
        volume: Number((avgVolume1m * 1.25).toFixed(6)),
      };
    }
  }

  const common: IndicatorSnapshot = {
    ...base,
    latestPrice: anchorPrice,
    emaFast,
    emaSlow,
    ema50,
    ema200,
    bbLower,
    bbMiddle,
    bbUpper,
    candles5,
    candles15: base.candles15?.length ? cloneCandles(base.candles15) : candles5,
    candles15m: base.candles15m?.length ? cloneCandles(base.candles15m) : candles5,
    candles1h: base.candles1h?.length ? cloneCandles(base.candles1h) : candles5,
    candles4h: base.candles4h?.length ? cloneCandles(base.candles4h) : candles5,
    avgVolume1m,
    imbalance_ratio: finitePositive(base.imbalance_ratio, 1.05),
    spreadBps: finitePositive(base.spreadBps, 4),
    marketRegime: base.marketRegime ?? "TRENDING",
    adx14: finitePositive(base.adx14, 24),
    atr14: finitePositive(base.atr14, anchorPrice * 0.004),
    trend_htf: base.trend_htf ?? {
      trend_1h: "bull",
      trend_4h: "bull",
      mtf_aligned: true,
      trend_15m: "bull",
      mtf_ltf_aligned: true,
      mtf_effective_ok: true,
    },
  };

  if (scenario === "oversold_buy") {
    const px = Number((anchorPrice * 0.992).toFixed(8));
    return {
      ...common,
      latestPrice: px,
      ema200: px * 0.985,
      ema50: px * 0.996,
      emaFast: px * 1.002,
      emaSlow: px * 0.999,
      rsi: 26,
      rsi15m: 30,
      bbLower: px * 1.008,
      bbMiddle: px * 1.02,
      bbUpper: px * 1.04,
      macd: {
        macd: Math.max(Number(base.macd?.macd ?? 0), 1.2),
        signal: Math.min(Number(base.macd?.signal ?? 0.8), 0.8),
        histogram: 0.4,
      },
    };
  }

  if (scenario === "force_paper_buy") {
    return {
      ...common,
      rsi: 58,
      rsi15m: 52,
    };
  }

  const momentumPrice = Math.max(anchorPrice, common.ema50);
  return {
    ...common,
    latestPrice: momentumPrice,
    rsi: 52,
    rsi15m: 50,
    macd: {
      macd: Math.max(Number(base.macd?.macd ?? 0), Number(base.macd?.signal ?? 0) + 0.01, 0.01),
      signal: Number(base.macd?.signal ?? 0),
      histogram: Number(base.macd?.histogram ?? 0.01),
    },
  };
}

/** Blend live AI with a paper-only BUY confirmation instead of a perfect stub. */
export function buildPaperScenarioAiStub(
  minAiConfidence: number,
  baseAi?: AiAnalysis,
): AiAnalysis {
  const floor = Number.isFinite(minAiConfidence) && minAiConfidence > 0
    ? minAiConfidence
    : 78;
  const liveConf = Number(baseAi?.ai_confidence);
  const confidence = Number.isFinite(liveConf) && liveConf >= floor
    ? Math.min(96, Math.max(floor, liveConf))
    : Math.min(100, Math.max(90, floor + 8));
  const trend = baseAi?.trend === "bearish" ? "neutral" : (baseAi?.trend ?? "bullish");
  return {
    ...baseAi,
    ai_confidence: confidence,
    trend,
    trend_alignment: baseAi?.trend_alignment ?? true,
    action: "BUY",
    groq_verdict: baseAi?.groq_verdict === "REJECT" ? "SKIPPED" : "APPROVE",
    groq_reason: "paper_scenario_confirm",
    ai_provider: baseAi?.ai_provider ?? "paper_scenario",
    ai_provider_path: baseAi?.ai_provider_path ?? "paper_scenario_confirm",
    ai_cache_status: baseAi?.ai_cache_status ?? "synthetic",
  };
}
