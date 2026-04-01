import type {
  DemoAccount,
  ScalpingRiskPlan,
  ScalpingSettings,
} from "@/lib/types";
import type { SignalAnalysisResult } from "@/lib/trading/signalAnalyzer";

export interface RiskManagerResult {
  allowed: boolean;
  blocker?: string;
  plan?: ScalpingRiskPlan;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function buildRiskPlan(params: {
  account: Partial<DemoAccount>;
  analysis: SignalAnalysisResult;
  settings: ScalpingSettings;
  tradeScore: number;
  preferredAllocationPct?: number;
}): RiskManagerResult {
  const { account, analysis, settings, tradeScore, preferredAllocationPct } =
    params;
  const startingBalance = Math.max(account.startingBalance ?? 0, 1);
  const currentBalance = Math.max(account.currentBalance ?? startingBalance, 0);
  const dailyPnl = account.dailyPnl ?? 0;
  const dailyLossUsedPct =
    dailyPnl < 0 ? Math.abs((dailyPnl / startingBalance) * 100) : 0;
  const dailyLossRemainingPct = clamp(
    settings.maxDailyLossPct - dailyLossUsedPct,
    0,
    settings.maxDailyLossPct,
  );

  if (account.circuitBreakerTripped || dailyLossRemainingPct <= 0) {
    return {
      allowed: false,
      blocker: `Daily loss limit reached (${dailyLossUsedPct.toFixed(2)}% used of ${settings.maxDailyLossPct}%).`,
    };
  }

  const confidenceFactor = clamp(analysis.signal.confidence / 100, 0.55, 1);
  const scoreFactor = clamp(tradeScore / 100, 0.55, 1);
  const volatilityHaircut =
    analysis.market.volatilitySpikePct > settings.maxVolatilitySpikePct * 0.8
      ? 0.72
      : analysis.market.volatilityPct < settings.minVolatilityPct * 1.1
        ? 0.8
        : 1;
  const liquidityBoost = clamp(
    analysis.market.liquidityUsd / Math.max(settings.minLiquidityUsd, 1),
    0.75,
    1.4,
  );

  const configuredCap = Math.min(
    settings.maxPositionSizePct,
    preferredAllocationPct
      ? preferredAllocationPct * 100
      : settings.maxPositionSizePct,
  );
  const positionSizePct = clamp(
    configuredCap *
      confidenceFactor *
      scoreFactor *
      volatilityHaircut *
      Math.min(liquidityBoost, 1.05),
    0.5,
    configuredCap,
  );
  const positionSizeUsd = Number(
    ((currentBalance * positionSizePct) / 100).toFixed(2),
  );

  if (positionSizeUsd < 50) {
    return {
      allowed: false,
      blocker: `Recommended position size is too small to execute cleanly ($${positionSizeUsd.toFixed(2)}).`,
    };
  }

  const referencePrice = analysis.signal.currentPrice;
  const stopLoss =
    analysis.direction === "long"
      ? referencePrice * (1 - settings.stopLossPct / 100)
      : referencePrice * (1 + settings.stopLossPct / 100);
  const takeProfit =
    analysis.direction === "long"
      ? referencePrice * (1 + settings.takeProfitPct / 100)
      : referencePrice * (1 - settings.takeProfitPct / 100);

  return {
    allowed: true,
    plan: {
      positionSizeUsd,
      positionSizePct: Number(positionSizePct.toFixed(2)),
      stopLoss: Number(stopLoss.toFixed(referencePrice >= 1 ? 4 : 6)),
      takeProfit: Number(takeProfit.toFixed(referencePrice >= 1 ? 4 : 6)),
      trailingStopPct: settings.useTrailingStop
        ? settings.trailingStopPct
        : undefined,
      dailyLossUsedPct: Number(dailyLossUsedPct.toFixed(2)),
      dailyLossRemainingPct: Number(dailyLossRemainingPct.toFixed(2)),
    },
  };
}
