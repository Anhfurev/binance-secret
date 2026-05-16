// @ts-nocheck
/**
 * Single source of truth for trading floors, risk defaults, and paper-practice gates.
 * Audit logs reference dotted keys under `TRADING_POLICY` (e.g. `confidence.tradeRegimeFloors.CHAOS.minAiConfidence`).
 */

const TRADE_REGIME_FLOORS = {
  STABLE: { minAiConfidence: 62, maxSpreadBps: 10, minVolume1mQuoteUsd: 0 },
  VOLATILE: { minAiConfidence: 70, maxSpreadBps: 25, minVolume1mQuoteUsd: 15_000 },
  CHAOS: { minAiConfidence: 78, maxSpreadBps: 80, minVolume1mQuoteUsd: 50_000 },
} as const;

export type TradeRegimeKey = keyof typeof TRADE_REGIME_FLOORS;

export const TRADING_POLICY = {
  confidence: {
    tradeRegimeFloors: TRADE_REGIME_FLOORS,
    /** Paper-only floor for weighted conviction (see buy-context). */
    paperWeightedAbsoluteFloor: 52,
    paperRangingBypassMinWeighted: 58,
    holdModelMarginPaper: 3,
    holdModelMarginLive: 5,
  },
  wallet: {
    /** At or below this wallet USD: apply stricter min AI (adds `lowBalanceMinAiDeltaPoints`). Low = aggressive testing / small accounts. */
    highBalanceUsdThreshold: 5,
    lowBalanceMinAiDeltaPoints: 5,
  },
  risk: {
    riskPerTradePercentDefault: 1,
    notionalCapFractionDefault: 0.15,
  },
  paperLiveStylePractice: {
    minTechScoreFloor: 6,
    minAiBoostVsIncoming: 54,
    minAiClampLower: 48,
    minAiClampUpper: 95,
    minTechClampLower: 4,
    minTechClampUpper: 10,
  },
} as const;

/**
 * Unified regime + wallet floor for raw / hybrid min AI style gates.
 * `walletBalanceUsd` null/NaN skips wallet delta (refs include `wallet.balance_unknown_skip_delta`).
 */
export function getRequiredConfidence(
  walletBalanceUsd: number | null | undefined,
  tradeRegime: TradeRegimeKey,
): { minAiConfidence: number; policy_rule_refs: string[] } {
  const refs: string[] = [];
  const base = TRADE_REGIME_FLOORS[tradeRegime].minAiConfidence;
  refs.push(`confidence.tradeRegimeFloors.${String(tradeRegime)}.minAiConfidence`);
  let v = base;
  if (walletBalanceUsd == null || !Number.isFinite(walletBalanceUsd)) {
    refs.push("wallet.balance_unknown_skip_delta");
    return { minAiConfidence: v, policy_rule_refs: refs };
  }
  if (walletBalanceUsd <= TRADING_POLICY.wallet.highBalanceUsdThreshold) {
    v = Math.min(
      TRADING_POLICY.paperLiveStylePractice.minAiClampUpper,
      v + TRADING_POLICY.wallet.lowBalanceMinAiDeltaPoints,
    );
    refs.push("wallet.lowBalanceMinAiDeltaPoints");
    refs.push("wallet.highBalanceUsdThreshold");
  } else {
    refs.push("wallet.above_low_balance_threshold");
  }
  return { minAiConfidence: v, policy_rule_refs: refs };
}

/** Snapshot for `war_room_audits.veto_details` without pulling env at log time. */
export function buildTradingPolicyAuditSnapshot(params: {
  tradeRegime: TradeRegimeKey;
  walletBalanceUsd: number | null;
  unifiedMinAi: number;
  policy_rule_refs: string[];
}): Record<string, unknown> {
  return {
    trade_regime: params.tradeRegime,
    wallet_balance_usd: params.walletBalanceUsd,
    unified_min_ai: params.unifiedMinAi,
    policy_rule_refs: params.policy_rule_refs,
    risk_defaults: {
      risk_per_trade_pct: TRADING_POLICY.risk.riskPerTradePercentDefault,
      notional_cap_fraction: TRADING_POLICY.risk.notionalCapFractionDefault,
      keys: ["risk.riskPerTradePercentDefault", "risk.notionalCapFractionDefault"],
    },
    paper_live_style: {
      min_tech_floor: TRADING_POLICY.paperLiveStylePractice.minTechScoreFloor,
      keys: ["paperLiveStylePractice.minTechScoreFloor"],
    },
  };
}
