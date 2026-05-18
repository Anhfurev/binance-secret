// @ts-nocheck
import type { BotSettingsRow, EntryCheckResult, IndicatorSnapshot } from "./types.ts";
import { calculateTechnicalScore, checkEntryConditions } from "./strategy.ts";
import { evaluateSmartNoiseFilter } from "./smart-filter.ts";
import { resolveMinTechScore, resolveMinVolume24hQuote } from "./utils.ts";
import { readTier1OversoldRsiMax } from "./ai-cascade-config.ts";

export type MathGuardInput = {
  symbol: string;
  snapshot: IndicatorSnapshot;
  openTrade: boolean;
  strategyEntry: EntryCheckResult;
  strategyExitTriggered: boolean;
  technicalScore: number;
  minTechScore: number;
  aggressiveModeEnabled: boolean;
  paperScenarioLiveAi?: boolean;
  moneyMachineSkipAi?: boolean;
  isSandboxMode?: boolean;
  isGhostExecution?: boolean;
  isPaperTrading?: boolean;
  paperRelaxed?: boolean;
  botSettingsRow?: BotSettingsRow | Record<string, unknown> | null;
};

export type MathGuardResult = {
  allowLlm: boolean;
  detail: string;
  skipLog: string | null;
  /** Tier 1 pass telemetry when flat-book math gate opens LLM cascade. */
  passLog: string | null;
};

export function buildTier1PassLog(symbol: string, rsi: number): string {
  const r = Number.isFinite(rsi) ? rsi.toFixed(1) : "n/a";
  return `[OVERSOLD_BOUNCE] Passed math check for ${symbol} | RSI: ${r}`;
}

const SKIP_PREFIX = "[SKIPPING] Math says NO BUY for";

export function buildMathGuardSkipLog(symbol: string, detail: string): string {
  return `${SKIP_PREFIX} ${symbol}. Bypassing AI call to save tokens. (${detail})`;
}

/** Flat book: strategy must emit BUY and pass volume/tech floors. Open book: exit math only. */
export function evaluateMathGuard(input: MathGuardInput): MathGuardResult {
  const symbol = String(input.symbol ?? "").trim() || "UNKNOWN";
  if (input.paperScenarioLiveAi) {
    return { allowLlm: true, detail: "paper_scenario_live_ai", skipLog: null, passLog: null };
  }
  if (input.moneyMachineSkipAi) {
    return {
      allowLlm: false,
      detail: "money_machine_skip_ai",
      skipLog: buildMathGuardSkipLog(symbol, "money_machine_skip_ai"),
      passLog: null,
    };
  }
  if (input.aggressiveModeEnabled && !input.openTrade) {
    return { allowLlm: true, detail: "aggressive_mode", skipLog: null, passLog: null };
  }

  if (input.openTrade) {
    if (input.strategyExitTriggered) {
      return { allowLlm: true, detail: "exit_math_triggered", skipLog: null, passLog: null };
    }
    if (input.strategyEntry.signal === "SELL") {
      return { allowLlm: true, detail: "strategy_sell_signal", skipLog: null, passLog: null };
    }
    return {
      allowLlm: false,
      detail: "open_position_hold_no_exit_math",
      skipLog: buildMathGuardSkipLog(symbol, "open_position_hold_no_exit_math"),
      passLog: null,
    };
  }

  const rsi = Number(input.snapshot.rsi);
  const tier1RsiMax = readTier1OversoldRsiMax();
  if (Number.isFinite(rsi) && rsi > tier1RsiMax) {
    return {
      allowLlm: false,
      detail: `tier1_rsi_${rsi}_above_${tier1RsiMax}`,
      skipLog: buildMathGuardSkipLog(
        symbol,
        `RSI_NOT_OVERSOLD:${rsi.toFixed(1)}>${tier1RsiMax}`,
      ),
      passLog: null,
    };
  }

  const lastCandle = input.snapshot.candles5?.at(-1);
  const smartNoise = evaluateSmartNoiseFilter({
    snapshot: input.snapshot,
    lastCandleVolume: Number(lastCandle?.volume ?? 0),
    hasOpenTrade: false,
    isGhostExecution: Boolean(input.isGhostExecution),
    paperRelaxed: Boolean(input.paperRelaxed),
    minVolume24hQuoteFromDb: resolveMinVolume24hQuote(
      (input.botSettingsRow ?? {}) as Record<string, unknown>,
    ),
  });
  if (smartNoise.sleepAi && !input.isSandboxMode) {
    return {
      allowLlm: false,
      detail: `smart_filter_sleep_ai:${smartNoise.vetoReasons.join(",") || "low_volume"}`,
      skipLog: buildMathGuardSkipLog(symbol, "smart_filter_sleep_ai"),
      passLog: null,
    };
  }

  if (input.strategyEntry.signal !== "BUY") {
    const fail = String(input.strategyEntry.strategy_fail_detail ?? "NO_BUY");
    return {
      allowLlm: false,
      detail: `strategy_${fail}`,
      skipLog: buildMathGuardSkipLog(symbol, fail),
      passLog: null,
    };
  }

  if (input.technicalScore < input.minTechScore) {
    return {
      allowLlm: false,
      detail: `tech_score_${input.technicalScore}_below_${input.minTechScore}`,
      skipLog: buildMathGuardSkipLog(
        symbol,
        `tech_score_${input.technicalScore}_below_${input.minTechScore}`,
      ),
      passLog: null,
    };
  }

  return {
    allowLlm: true,
    detail: String(input.strategyEntry.strategy_reason ?? "strategy_buy"),
    skipLog: null,
    passLog: buildTier1PassLog(symbol, rsi),
  };
}

/** Cron multi-symbol batch: only symbols whose entry math is BUY (no LLM for flat tape). */
export function isSnapshotMathPrimedForLlm(
  snapshot: IndicatorSnapshot,
  opts?: { paperExploration?: boolean; botSettings?: BotSettingsRow | null },
): boolean {
  const entry = checkEntryConditions(snapshot, opts);
  if (entry.signal !== "BUY") return false;
  const rsi = Number(snapshot.rsi);
  if (Number.isFinite(rsi) && rsi > readTier1OversoldRsiMax()) return false;
  const minTech = resolveMinTechScore((opts?.botSettings ?? {}) as Record<string, unknown>);
  return calculateTechnicalScore(snapshot) >= minTech;
}
