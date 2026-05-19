import type { Scalp1mSnapshot } from "@/lib/trading/paper-scalp-indicators";

export type PaperMomentumBuyReason =
  | "trend_resumption"
  | "oversold_bounce"
  | "velocity_breakout";

export type PaperMomentumShortReason =
  | "bearish_resumption"
  | "overbought_fade"
  | "velocity_breakdown";

export type PaperMomentumSettings = {
  rsiBuyThreshold: number;
  rsiOversoldPanic: number;
  rsiMaxBuy: number;
};

export type PaperBuyEvaluation = {
  shouldBuy: boolean;
  reason: PaperMomentumBuyReason | "no_signal" | "rsi_overbought";
};

export type PaperShortEvaluation = {
  shouldShort: boolean;
  reason: PaperMomentumShortReason | "no_signal" | "rsi_oversold";
};

export function resolvePaperMomentumSettings(
  paper: {
    rsiBuyThreshold?: number;
    rsiOversoldPanic?: number;
  },
  envRsiMax = 70,
): PaperMomentumSettings {
  const rsiBuyThreshold =
    Number.isFinite(paper.rsiBuyThreshold) && paper.rsiBuyThreshold! > 0
      ? Math.min(paper.rsiBuyThreshold!, 85)
      : 55;
  const rsiOversoldPanic =
    Number.isFinite(paper.rsiOversoldPanic) && paper.rsiOversoldPanic! > 0
      ? Math.min(paper.rsiOversoldPanic!, 45)
      : 30;
  const rsiMaxBuy =
    Number.isFinite(envRsiMax) && envRsiMax > 50 ? Math.min(envRsiMax, 90) : 70;
  return { rsiBuyThreshold, rsiOversoldPanic, rsiMaxBuy };
}

/** Aggressive momentum entry — not strict crossover-only. */
export function evaluatePaperBuySignal(
  snap: Scalp1mSnapshot,
  settings: PaperMomentumSettings,
): PaperBuyEvaluation {
  const rsi = snap.rsi14;

  if (rsi > settings.rsiMaxBuy) {
    return { shouldBuy: false, reason: "rsi_overbought" };
  }

  if (rsi <= settings.rsiOversoldPanic) {
    return { shouldBuy: true, reason: "oversold_bounce" };
  }

  if (snap.ema9 > snap.ema21 && rsi <= settings.rsiBuyThreshold) {
    return { shouldBuy: true, reason: "trend_resumption" };
  }

  return { shouldBuy: false, reason: "no_signal" };
}

/** Bearish momentum entry for RISK_OFF short regime. */
export function evaluatePaperShortSignal(
  snap: Scalp1mSnapshot,
  settings: PaperMomentumSettings,
): PaperShortEvaluation {
  const rsi = snap.rsi14;

  if (rsi < settings.rsiOversoldPanic) {
    return { shouldShort: false, reason: "rsi_oversold" };
  }

  if (rsi >= settings.rsiMaxBuy && snap.ema9 < snap.ema21) {
    return { shouldShort: true, reason: "overbought_fade" };
  }

  if (snap.ema9 < snap.ema21 && rsi >= settings.rsiBuyThreshold) {
    return { shouldShort: true, reason: "bearish_resumption" };
  }

  return { shouldShort: false, reason: "no_signal" };
}

export function rankShortMomentumCandidates(
  snapshots: Scalp1mSnapshot[],
  settings: PaperMomentumSettings,
): Array<{ snap: Scalp1mSnapshot; evaluation: PaperShortEvaluation }> {
  return snapshots
    .map((snap) => ({
      snap,
      evaluation: evaluatePaperShortSignal(snap, settings),
    }))
    .filter((row) => row.evaluation.shouldShort)
    .sort((a, b) => b.snap.rsi14 - a.snap.rsi14);
}

export function rankMomentumCandidates(
  snapshots: Scalp1mSnapshot[],
  settings: PaperMomentumSettings,
): Array<{ snap: Scalp1mSnapshot; evaluation: PaperBuyEvaluation }> {
  return snapshots
    .map((snap) => ({
      snap,
      evaluation: evaluatePaperBuySignal(snap, settings),
    }))
    .filter((row) => row.evaluation.shouldBuy)
    .sort((a, b) => {
      if (
        a.evaluation.reason === "oversold_bounce" &&
        b.evaluation.reason !== "oversold_bounce"
      ) {
        return -1;
      }
      if (
        b.evaluation.reason === "oversold_bounce" &&
        a.evaluation.reason !== "oversold_bounce"
      ) {
        return 1;
      }
      return b.snap.rsi14 - a.snap.rsi14;
    });
}
