// @ts-nocheck
import type { AiAnalysis, IndicatorSnapshot } from "./types.ts";
import { computeWeightedConfidence } from "./ai-scoring.ts";
import { clamp } from "./utils.ts";

/**
 * Pure tape fallback when every LLM key is rate-limited / cooling down.
 * Keeps the symbol cycle alive (RSI + volume + order book) without throwing.
 */
export function buildTechnicalIndicatorFallback(
  snapshot: IndicatorSnapshot,
): AiAnalysis {
  const rsi = Number(snapshot.rsi);
  const vol1m = Number(snapshot.candles5?.at(-1)?.volume ?? 0);
  const avgVol = Number(snapshot.avgVolume1m ?? 0);
  const imbalance = Number(snapshot.imbalance_ratio ?? 1);
  const price = Number(snapshot.latestPrice);
  const emaFast = Number(snapshot.emaFast);
  const emaSlow = Number(snapshot.emaSlow);

  const volumeRatio = avgVol > 0 ? vol1m / avgVol : 1;
  const trendUp = price > emaSlow && emaFast >= emaSlow;
  const trendDown = price < emaSlow && emaFast <= emaSlow;

  let momentumScore = 50;
  if (rsi < 32) momentumScore = 72;
  else if (rsi < 45) momentumScore = 62;
  else if (rsi > 72) momentumScore = 28;
  else if (rsi > 65) momentumScore = 38;

  let volumeScore = 50;
  if (volumeRatio >= 2.5) volumeScore = 78;
  else if (volumeRatio >= 1.4) volumeScore = 65;
  else if (volumeRatio < 0.6) volumeScore = 35;

  let orderBookScore = 50;
  if (imbalance >= 1.35) orderBookScore = 68;
  else if (imbalance <= 0.72) orderBookScore = 32;

  let trendScore = 50;
  if (trendUp) trendScore = 62;
  if (trendDown) trendScore = 38;

  const buyTape =
    rsi < 48 &&
    volumeRatio >= 1.1 &&
    imbalance >= 0.95 &&
    !trendDown;
  const sellTape =
    rsi > 70 ||
    (trendDown && volumeRatio >= 1.2 && imbalance < 0.85);

  const action: AiAnalysis["action"] = sellTape ? "SELL" : buyTape ? "BUY" : "HOLD";
  const trend = trendUp ? "bullish" : trendDown ? "bearish" : "neutral";

  const base: AiAnalysis = {
    ai_confidence: 0,
    trend,
    trend_alignment: trendUp || trend === "neutral",
    action,
    trend_score: clamp(trendScore, 0, 100),
    momentum_score: clamp(momentumScore, 0, 100),
    volume_score: clamp(volumeScore, 0, 100),
    order_book_score: clamp(orderBookScore, 0, 100),
    groq_verdict: "TECH_FALLBACK",
    groq_reason:
      `technical_rsi_volume: rsi=${rsi.toFixed(1)} vol1m/avg=${volumeRatio.toFixed(2)} ob=${imbalance.toFixed(2)}`,
    ai_provider: "fallback",
    ai_provider_path: "technical_rsi_volume",
  };
  base.ai_confidence = computeWeightedConfidence(base);
  return base;
}
