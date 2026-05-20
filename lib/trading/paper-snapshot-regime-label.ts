import type { DynamicMarketRegime } from "@/lib/trading/paper-scalp-regime";

export function formatRegimeLabel(regime: DynamicMarketRegime): string {
  const state =
    regime.state === "bullish"
      ? "BULLISH"
      : regime.state === "neutral"
        ? "NEUTRAL"
        : "RISK_OFF";
  const size = `${Math.round(regime.altSizeMultiplier * 100)}% size`;
  const deploy = `top ${regime.deployTopN}`;
  const trend = `trend ${regime.trendScore.score}`;
  if (regime.fallback) return `FALLBACK · ${state} · ${trend}`;
  return `${state} · ${trend} · ${size} · ${deploy}`;
}
