import type { ScalpingSettings } from "@/lib/types";
import type { SignalAnalysisResult } from "@/lib/trading/signalAnalyzer";

export interface MarketFilterResult {
  passed: boolean;
  blockers: string[];
  reasons: string[];
}

export function evaluateMarketFilters(
  analysis: SignalAnalysisResult,
  settings: ScalpingSettings,
): MarketFilterResult {
  const blockers: string[] = [];
  const reasons: string[] = [];

  if (!analysis.direction) {
    blockers.push(
      "AI signal is HOLD, so there is no scalping direction to execute.",
    );
  }

  if (analysis.signal.confidence < settings.minAiConfidence) {
    blockers.push(
      `AI confidence ${analysis.signal.confidence}% is below the ${settings.minAiConfidence}% threshold.`,
    );
  } else {
    reasons.push(`AI confidence cleared at ${analysis.signal.confidence}%.`);
  }

  if (
    analysis.market.expectedProfitPct <
    analysis.market.totalFeePct * settings.minExpectedProfitToFeeRatio
  ) {
    blockers.push(
      `Expected profit ${analysis.market.expectedProfitPct}% does not cover ${settings.minExpectedProfitToFeeRatio}x fees (${analysis.market.totalFeePct}%).`,
    );
  } else {
    reasons.push(
      `Profit-to-fee ratio is ${(analysis.market.expectedProfitPct / Math.max(analysis.market.totalFeePct, 0.001)).toFixed(2)}x.`,
    );
  }

  if (analysis.market.spreadPct > settings.maxSpreadPct) {
    blockers.push(
      `Spread ${analysis.market.spreadPct}% is wider than the ${settings.maxSpreadPct}% limit.`,
    );
  } else {
    reasons.push(`Spread remains tight at ${analysis.market.spreadPct}%.`);
  }

  if (analysis.market.liquidityUsd < settings.minLiquidityUsd) {
    blockers.push(
      `Liquidity $${analysis.market.liquidityUsd.toLocaleString()} is below the minimum $${settings.minLiquidityUsd.toLocaleString()}.`,
    );
  } else {
    reasons.push(
      `Liquidity is strong at $${analysis.market.liquidityUsd.toLocaleString()}.`,
    );
  }

  if (analysis.market.volatilityPct < settings.minVolatilityPct) {
    blockers.push(
      `Volatility ${analysis.market.volatilityPct}% is too flat for scalping.`,
    );
  } else {
    reasons.push(`Volatility is active at ${analysis.market.volatilityPct}%.`);
  }

  if (analysis.market.volatilitySpikePct > settings.maxVolatilitySpikePct) {
    blockers.push(
      `Volatility spike ${analysis.market.volatilitySpikePct}% exceeds the ${settings.maxVolatilitySpikePct}% ceiling.`,
    );
  }

  if (analysis.confirmationCount < settings.requiredTechnicalConfirmations) {
    blockers.push(
      `${analysis.confirmationCount} technical confirmations agree, below the required ${settings.requiredTechnicalConfirmations}.`,
    );
  } else {
    reasons.push(
      `${analysis.confirmationCount} technical confirmations agree with the AI signal.`,
    );
  }

  if (analysis.market.orderBookDepthUsd < settings.minOrderBookDepthUsd) {
    blockers.push(
      `Order book depth $${analysis.market.orderBookDepthUsd.toLocaleString()} is below the required $${settings.minOrderBookDepthUsd.toLocaleString()}.`,
    );
  } else {
    reasons.push(
      `Order book depth is healthy at $${analysis.market.orderBookDepthUsd.toLocaleString()}.`,
    );
  }

  if (analysis.market.estimatedSlippagePct > settings.maxSlippagePct) {
    blockers.push(
      `Estimated slippage ${analysis.market.estimatedSlippagePct}% is above the ${settings.maxSlippagePct}% cap.`,
    );
  } else {
    reasons.push(
      `Estimated slippage is contained at ${analysis.market.estimatedSlippagePct}%.`,
    );
  }

  return {
    passed: blockers.length === 0,
    blockers,
    reasons,
  };
}
