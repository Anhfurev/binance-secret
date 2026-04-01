import type {
  AITradeSignal,
  CoinData,
  DemoAccount,
  ScalpingDecision,
  ScalpingSettings,
} from "@/lib/types";
import { evaluateMarketFilters } from "@/lib/trading/marketFilter";
import { buildRiskPlan } from "@/lib/trading/riskManager";
import { analyzeSignal } from "@/lib/trading/signalAnalyzer";
import { buildExecutionPlan } from "@/lib/trading/tradeExecutor";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildTradeScore(params: ReturnType<typeof analyzeSignal>) {
  return clamp(
    params.signal.confidence * 0.45 +
      params.market.volumeStrength * 0.2 +
      params.market.trendStrength * 0.2 +
      params.market.volatilityScore * 0.15,
    0,
    100,
  );
}

export function evaluateScalpingTrade(params: {
  signal: AITradeSignal;
  coin?: CoinData;
  account: Partial<DemoAccount>;
  settings: ScalpingSettings;
  preferredAllocationPct?: number;
}): ScalpingDecision {
  const { signal, coin, account, settings, preferredAllocationPct } = params;
  const analysis = analyzeSignal({ signal, coin, settings });
  const score = buildTradeScore(analysis);
  const filters = evaluateMarketFilters(analysis, settings);

  if (account.circuitBreakerTripped) {
    return {
      status: "halt",
      direction: analysis.direction,
      score: Number(score.toFixed(1)),
      requiredScore: settings.minTradeScore,
      reasons: [],
      blockers: [
        "Daily loss circuit breaker is active. New trades are disabled.",
      ],
      confirmations: analysis.confirmations,
      confirmationCount: analysis.confirmationCount,
      market: analysis.market,
    };
  }

  if (score < settings.minTradeScore) {
    filters.blockers.push(
      `Trade score ${score.toFixed(1)} is below the required ${settings.minTradeScore}.`,
    );
  } else {
    filters.reasons.push(
      `Trade score qualifies at ${score.toFixed(1)} / ${settings.minTradeScore}.`,
    );
  }

  if (filters.blockers.length > 0) {
    return {
      status: "skip",
      direction: analysis.direction,
      score: Number(score.toFixed(1)),
      requiredScore: settings.minTradeScore,
      reasons: filters.reasons,
      blockers: filters.blockers,
      confirmations: analysis.confirmations,
      confirmationCount: analysis.confirmationCount,
      market: analysis.market,
    };
  }

  const risk = buildRiskPlan({
    account,
    analysis,
    settings,
    tradeScore: score,
    preferredAllocationPct,
  });

  if (!risk.allowed || !risk.plan) {
    return {
      status: risk.blocker?.includes("Daily loss") ? "halt" : "skip",
      direction: analysis.direction,
      score: Number(score.toFixed(1)),
      requiredScore: settings.minTradeScore,
      reasons: filters.reasons,
      blockers: risk.blocker ? [risk.blocker] : [],
      confirmations: analysis.confirmations,
      confirmationCount: analysis.confirmationCount,
      market: analysis.market,
    };
  }

  const execution = buildExecutionPlan({
    signal,
    analysis,
    riskPlan: risk.plan,
  });

  return {
    status: "execute",
    direction: analysis.direction,
    score: Number(score.toFixed(1)),
    requiredScore: settings.minTradeScore,
    reasons: filters.reasons,
    blockers: [],
    confirmations: analysis.confirmations,
    confirmationCount: analysis.confirmationCount,
    market: analysis.market,
    risk: risk.plan,
    execution,
  };
}
