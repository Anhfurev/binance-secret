// @ts-nocheck
/**
 * Symbol-cycle routing: open-position exit supervisor vs flat-book entry preflight.
 * Partial exits keep `status=open` with reduced `amount` — routing keys off DB leg, not SELL signal.
 */
import type { EntryCheckResult, OpenTradeRow, SignalDecision } from "./types.ts";
import { shouldTriggerPartialTakeProfit } from "./sell-partial-tp.ts";
import { toNumber } from "./utils.ts";

const OPEN_STATUS = "open";
const MIN_REMAINING_BASE = 1e-12;

/** Authoritative supervisor gate: open row with remaining base (post-partial or full). */
export function resolveHasOpenPositionFromOpenTrade(
  openTrade: OpenTradeRow | null | undefined,
): boolean {
  if (!openTrade) return false;
  const status = String(openTrade.status ?? OPEN_STATUS).trim().toLowerCase();
  if (status !== OPEN_STATUS) return false;
  const amount = toNumber(openTrade.amount, NaN);
  if (Number.isFinite(amount) && amount <= MIN_REMAINING_BASE) return false;
  return true;
}

/** Trade row used for exit math — null when no active leg remains. */
export function resolveSupervisorOpenTrade(
  openTrade: OpenTradeRow | null | undefined,
): OpenTradeRow | null {
  return resolveHasOpenPositionFromOpenTrade(openTrade) ? openTrade : null;
}

export function readPartialTakeProfitExecuted(
  openTrade: OpenTradeRow | null | undefined,
): boolean {
  const extra = (openTrade?.extra as Record<string, unknown> | undefined) ?? {};
  return extra.partial_tp_executed === true;
}

export type BuyLlmPreflightBlock = {
  blocked: boolean;
  detail: string;
  log: string | null;
};

export function collectExitSupervisorPreflight(): {
  scorecard: Record<string, boolean>;
  veto_reasons: string[];
  passedCount: number;
  totalGates: number;
  ema200RecoveryOk: boolean;
  rsiClimbing: boolean;
} {
  return {
    scorecard: { exit_supervisor: true },
    veto_reasons: [],
    passedCount: 1,
    totalGates: 1,
    ema200RecoveryOk: true,
    rsiClimbing: false,
  };
}

/**
 * SELL = request exit-supervisor action (partial TP first in bot.ts, then remainder).
 * Does not mean flat book — `hasOpenPosition` from DB remains true until row closes.
 */
export function resolvePositionSupervisorStrategySignal(
  effectiveStrategyExit: { shouldExit: boolean },
): SignalDecision {
  return effectiveStrategyExit.shouldExit ? "SELL" : "HOLD";
}

/** Telemetry for partial vs full exit leg (does not affect flat-book routing). */
export function resolvePositionSupervisorExitHint(
  openTrade: OpenTradeRow | null | undefined,
  latestPrice: number,
): string {
  if (!resolveHasOpenPositionFromOpenTrade(openTrade)) return "no_active_leg";
  if (
    openTrade &&
    Number.isFinite(latestPrice) &&
    latestPrice > 0 &&
    shouldTriggerPartialTakeProfit(openTrade, latestPrice)
  ) {
    return "partial_tp_due";
  }
  if (readPartialTakeProfitExecuted(openTrade)) return "partial_leg_manage";
  return "exit_supervisor";
}

export function buildOpenPositionSupervisorEntry(
  openTrade?: OpenTradeRow | null,
): EntryCheckResult {
  const partialLeg = readPartialTakeProfitExecuted(openTrade);
  return {
    signal: "HOLD",
    strategy_reason: partialLeg
      ? "open_position_exit_supervisor_partial_leg"
      : "open_position_exit_supervisor",
    strategy_fail_detail: null,
  };
}

/** Flat book only — hard block before any LLM (ignores aggressive-mode math bypass). */
export function evaluateBuyLlmPreflightBlock(input: {
  symbol: string;
  hasOpenPosition: boolean;
  strategyEntry: EntryCheckResult;
  strategyFailDetail: string | null;
  preflightVetoReasons: string[];
}): BuyLlmPreflightBlock {
  if (input.hasOpenPosition) {
    return { blocked: false, detail: "open_position_exit_path", log: null };
  }
  if (input.strategyEntry.signal !== "BUY") {
    const fail = String(input.strategyEntry.strategy_fail_detail ?? "NO_BUY");
    const detail = `FAIL_STRATEGY:${fail}`;
    return {
      blocked: true,
      detail,
      log:
        `[PIPELINE] ${input.symbol} buy_preflight_abort strategy_buy_ok=false detail=${detail}`,
    };
  }
  if (input.strategyFailDetail) {
    return {
      blocked: true,
      detail: input.strategyFailDetail,
      log:
        `[PIPELINE] ${input.symbol} buy_preflight_abort detail=${input.strategyFailDetail}`,
    };
  }
  const hardFails = input.preflightVetoReasons.filter((r) => r.startsWith("FAIL_"));
  if (hardFails.length) {
    return {
      blocked: true,
      detail: hardFails.join(","),
      log:
        `[PIPELINE] ${input.symbol} buy_preflight_abort vetoes=${hardFails.join(",")}`,
    };
  }
  return { blocked: false, detail: "buy_preflight_clear", log: null };
}

export function shouldUsePrefetchedBuyAiVerdict(
  prefetched: { ai: unknown; aiQuotaFallback: boolean } | null | undefined,
  hasOpenPosition: boolean,
  buyPreflightBlock: BuyLlmPreflightBlock,
): boolean {
  return Boolean(prefetched) && !hasOpenPosition && !buyPreflightBlock.blocked;
}
