import type {
  AITradeSignal,
  DemoTrade,
  ScalpingExecutionPlan,
  ScalpingRiskPlan,
} from "@/lib/types";
import type { SignalAnalysisResult } from "@/lib/trading/signalAnalyzer";

export function buildExecutionPlan(params: {
  signal: AITradeSignal;
  analysis: SignalAnalysisResult;
  riskPlan: ScalpingRiskPlan;
}): ScalpingExecutionPlan {
  const { signal, analysis, riskPlan } = params;
  const rawEntry = signal.currentPrice;
  const impactPct =
    analysis.market.spreadPct / 2 + analysis.market.estimatedSlippagePct;
  const entryPrice =
    analysis.direction === "short"
      ? rawEntry * (1 - impactPct / 100)
      : rawEntry * (1 + impactPct / 100);
  const quantity = riskPlan.positionSizeUsd / Math.max(entryPrice, 1e-9);

  return {
    entryPrice: Number(entryPrice.toFixed(rawEntry >= 1 ? 4 : 6)),
    notionalUsd: riskPlan.positionSizeUsd,
    quantity: Number(quantity.toFixed(6)),
    spreadPct: analysis.market.spreadPct,
    slippagePct: analysis.market.estimatedSlippagePct,
    feePct: analysis.market.totalFeePct,
  };
}

export function createDemoTradeFromExecution(params: {
  signal: AITradeSignal;
  followedSignal: boolean;
  execution: ScalpingExecutionPlan;
  riskPlan: ScalpingRiskPlan;
  decisionScore: number;
  reasons: string[];
}): DemoTrade {
  const {
    signal,
    followedSignal,
    execution,
    riskPlan,
    decisionScore,
    reasons,
  } = params;

  return {
    id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    signalId: signal.id,
    coinId: signal.coinId,
    symbol: signal.symbol,
    type: signal.signalType.includes("SELL") ? "sell" : "buy",
    entryPrice: execution.entryPrice,
    amount: execution.quantity,
    value: execution.notionalUsd,
    status: "open",
    openedAt: new Date(),
    stopLoss: riskPlan.stopLoss,
    takeProfit: riskPlan.takeProfit,
    trailingStopPct: riskPlan.trailingStopPct,
    decisionScore: Number(decisionScore.toFixed(1)),
    estimatedSlippagePct: execution.slippagePct,
    spreadPct: execution.spreadPct,
    executionNotes: reasons.slice(0, 6),
    followedSignal,
  };
}
