// @ts-nocheck
import type {
  EntryCheckResult,
  IndicatorSnapshot,
  SignalDecision,
  StrategyReason,
} from "./types.ts";

function fastGt(left: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const scale = Math.max(Number.EPSILON, Math.abs(left), Math.abs(right));
  return left - right > 1e-8 * scale;
}

/** Paper-only micro-momentum path to reduce `hold_no_strategy_buy` starvation (live ignores). */
export function maybePaperStrategyExplorationBuy(
  snapshot: IndicatorSnapshot,
): { signal: SignalDecision; strategy_reason: StrategyReason } | null {
  const c = snapshot.candles5 ?? [];
  const c1 = Number(c.at(-1)?.close ?? 0);
  const c2 = Number(c.at(-2)?.close ?? 0);
  const c0 = Number(c.at(-3)?.close ?? 0);
  const risingMicro = c1 > c2 && c2 > c0;
  const lastVol = Number(c.at(-1)?.volume ?? 0);
  const avg1m = Number(snapshot.avgVolume1m ?? 0);
  const volOk = avg1m <= 0 || lastVol >= avg1m * 1.03;
  const adx = Number(snapshot.adx14);
  const rsi = snapshot.rsi;
  if (
    risingMicro &&
    volOk &&
    Number.isFinite(adx) &&
    adx >= 12 &&
    rsi >= 38 &&
    rsi <= 63 &&
    fastGt(snapshot.emaFast, snapshot.emaSlow * 0.996) &&
    snapshot.ema50 > 0 &&
    snapshot.latestPrice >= snapshot.ema50 * 0.988
  ) {
    return { signal: "BUY", strategy_reason: "strategy_paper_exploration_entry" };
  }
  return null;
}

export function applyPaperExplorationToEntry(
  snapshot: IndicatorSnapshot,
  opts?: { paperExploration?: boolean },
): EntryCheckResult | null {
  if (!opts?.paperExploration) return null;
  return maybePaperStrategyExplorationBuy(snapshot);
}
