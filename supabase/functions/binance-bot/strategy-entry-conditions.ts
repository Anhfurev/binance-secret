// @ts-nocheck
import type { EntryCheckResult, IndicatorSnapshot, BotSettingsRow } from "./types.ts";
import { resolveStrategyBuyRsiMax } from "./config.ts";
import { applyPaperExplorationToEntry } from "./strategy-paper-exploration.ts";
import { gtWithTolerance, gteWithTolerance } from "./strategy-numeric-tolerance.ts";
import { isDeepOversoldRsi, readDeepOversoldRsiThreshold } from "./strategy-oversold-bounce.ts";
import { isTrendingOrBullishSnapshot } from "./strategy-hybrid-gates.ts";
import {
  detectDynamicTradingRegime,
  resolveRegimeGatePolicy,
  trySidewaysGrinderEntry,
} from "./dynamic-regime-switcher.ts";

// Freqtrade BbandRsi populate_entry_trend:
// (rsi < STRATEGY_BUY_RSI_THRESHOLD) AND (close < bb_lowerband) => enter_long
export function checkEntryConditions(
  snapshot: IndicatorSnapshot,
  opts?: { paperExploration?: boolean; botSettings?: BotSettingsRow | null },
): EntryCheckResult {
  const buyRsiMax = resolveStrategyBuyRsiMax(opts?.botSettings);
  const dynDiag = detectDynamicTradingRegime(snapshot);
  const gatePolicy = resolveRegimeGatePolicy(dynDiag.regime);
  const sidewaysGrinder = trySidewaysGrinderEntry(snapshot, gatePolicy);
  if (sidewaysGrinder) {
    return sidewaysGrinder;
  }

  const nearLowerBb =
    snapshot.bbLower > 0 &&
    snapshot.latestPrice <= snapshot.bbLower * 1.022;

  /**
   * Prime bounce: RSI &lt; 35 (default) at lower BB — no fast&gt;slow EMA requirement so
   * entries can fire while macro MAs are still bearish; `min_tech_score` is relaxed in cycle-decider.
   */
  const deepOversoldBounce = isDeepOversoldRsi(snapshot.rsi) && nearLowerBb;
  if (deepOversoldBounce) {
    return { signal: "BUY", strategy_reason: "strategy_oversold_bounce_entry" };
  }

  /** Softer oversold / lower-BB kiss; RSI cap follows `buyRsiMax` (needs mild EMA alignment). */
  const oversoldBounceRsiMax = buyRsiMax;
  const oversoldBounce =
    snapshot.rsi > 0 &&
    snapshot.rsi < oversoldBounceRsiMax &&
    snapshot.rsi >= readDeepOversoldRsiThreshold() &&
    nearLowerBb &&
    gtWithTolerance(snapshot.emaFast, snapshot.emaSlow * 0.995);
  if (oversoldBounce) {
    return { signal: "BUY", strategy_reason: "strategy_oversold_bounce_entry" };
  }

  if (snapshot.rsi < buyRsiMax && gtWithTolerance(snapshot.bbLower, snapshot.latestPrice)) {
    return { signal: "BUY", strategy_reason: "freqtrade_bbrsi_entry_confirmed" };
  }

  const c = snapshot.candles5 ?? [];
  const c1 = c.at(-1)?.close ?? 0;
  const c2 = c.at(-2)?.close ?? 0;
  const c3 = c.at(-3)?.close ?? 0;
  const risingMicro = c1 > c2 && c2 > c3;
  const lastVolume = Number(c.at(-1)?.volume ?? 0);
  const avgVolume1m = Number(snapshot.avgVolume1m ?? 0);
  const volumeConfirmed = avgVolume1m > 0 && lastVolume > avgVolume1m * 1.2;
  const volumeSoft = avgVolume1m <= 0 || lastVolume >= avgVolume1m * 0.95;
  const priceNearEma50 =
    snapshot.ema50 > 0 &&
    snapshot.latestPrice >= snapshot.ema50 * 0.992;
  const bullishMomentum =
    snapshot.rsi >= 36 &&
    snapshot.rsi <= 72 &&
    snapshot.rsi15m >= 42 &&
    gtWithTolerance(snapshot.emaFast, snapshot.emaSlow) &&
    (gteWithTolerance(snapshot.latestPrice, snapshot.ema50) || priceNearEma50) &&
    risingMicro &&
    volumeConfirmed &&
    (snapshot.marketRegime === "TRENDING" || Number(snapshot.adx14) >= 22);
  if (bullishMomentum) {
    return { signal: "BUY", strategy_reason: "strategy_trend_momentum_entry" };
  }

  /**
   * Grinding uptrend: fast > slow, price on/near EMA50; may sit under EMA200 if 5m volume thrust confirms scalp.
   */
  const above50 = gteWithTolerance(snapshot.latestPrice, snapshot.ema50);
  const grindBelow200Ok =
    above50 &&
    !gteWithTolerance(snapshot.latestPrice, snapshot.ema200) &&
    volumeConfirmed &&
    snapshot.rsi > 32 &&
    snapshot.rsi < Math.min(56, buyRsiMax + 4);
  const trendGrindBuy =
    (snapshot.marketRegime === "TRENDING" || Number(snapshot.adx14) >= 20) &&
    gtWithTolerance(snapshot.emaFast, snapshot.emaSlow) &&
    above50 &&
    (gteWithTolerance(snapshot.latestPrice, snapshot.ema200) || grindBelow200Ok) &&
    snapshot.rsi > 32 &&
    snapshot.rsi < Math.min(58, buyRsiMax + 6) &&
    risingMicro &&
    (volumeSoft || volumeConfirmed);
  if (trendGrindBuy) {
    return { signal: "BUY", strategy_reason: "strategy_trend_grind_entry" };
  }

  /** Tape near EMA50 (pullback ribbon); RSI band follows `buyRsiMax` for scalp pullbacks (e.g. &lt;48–54). */
  const ema50Bounce =
    snapshot.ema50 > 0 &&
    snapshot.latestPrice >= snapshot.ema50 * 0.978 &&
    snapshot.latestPrice <= snapshot.ema50 * 1.022 &&
    snapshot.rsi >= 28 &&
    snapshot.rsi < Math.min(52, buyRsiMax + 1) &&
    risingMicro &&
    volumeSoft &&
    gtWithTolerance(snapshot.emaFast, snapshot.emaSlow * 0.99);
  if (ema50Bounce) {
    return { signal: "BUY", strategy_reason: "strategy_ema50_bounce_entry" };
  }

  const rangingPullback =
    snapshot.marketRegime === "RANGING" &&
    snapshot.rsi >= 30 &&
    snapshot.rsi <= 50 &&
    risingMicro &&
    snapshot.bbLower > 0 &&
    snapshot.latestPrice <= snapshot.bbLower * 1.015 &&
    gtWithTolerance(snapshot.emaFast, snapshot.emaSlow * 0.998);
  if (rangingPullback) {
    return { signal: "BUY", strategy_reason: "strategy_ranging_pullback_entry" };
  }

  const structureRecovery =
    snapshot.rsi >= 42 &&
    snapshot.rsi <= 62 &&
    risingMicro &&
    gtWithTolerance(snapshot.emaFast, snapshot.emaSlow) &&
    (priceNearEma50 ||
      (snapshot.bbLower > 0 && snapshot.latestPrice <= snapshot.bbLower * 1.02)) &&
    volumeConfirmed;
  if (structureRecovery) {
    return { signal: "BUY", strategy_reason: "strategy_structure_recovery_entry" };
  }

  const hybridNeutralMomentum =
    isTrendingOrBullishSnapshot(snapshot) &&
    snapshot.rsi >= 48 &&
    snapshot.rsi <= Math.min(68, buyRsiMax + 16) &&
    gtWithTolerance(snapshot.emaFast, snapshot.emaSlow) &&
    (gteWithTolerance(snapshot.latestPrice, snapshot.ema50) || priceNearEma50) &&
    risingMicro &&
    (volumeSoft || volumeConfirmed);
  if (hybridNeutralMomentum) {
    return { signal: "BUY", strategy_reason: "strategy_hybrid_neutral_momentum_entry" };
  }

  const grindStyleBelow200 =
    snapshot.ema50 > 0 &&
    gteWithTolerance(snapshot.latestPrice, snapshot.ema50 * 0.988) &&
    !gteWithTolerance(snapshot.latestPrice, snapshot.ema200) &&
    volumeConfirmed;
  const hybridBreakout =
    isTrendingOrBullishSnapshot(snapshot) &&
    snapshot.rsi >= 50 &&
    snapshot.rsi <= 72 &&
    gtWithTolerance(snapshot.emaFast, snapshot.emaSlow) &&
    (gteWithTolerance(snapshot.latestPrice, snapshot.ema200) || grindStyleBelow200) &&
    risingMicro &&
    (volumeSoft || volumeConfirmed);
  if (hybridBreakout) {
    return { signal: "BUY", strategy_reason: "strategy_hybrid_breakout_entry" };
  }

  const paperBuy = applyPaperExplorationToEntry(snapshot, opts);
  if (paperBuy) return paperBuy;

  if (snapshot.rsi > 70) {
    return {
      signal: "SELL",
      strategy_reason: "freqtrade_bbrsi_exit_signal",
      strategy_fail_detail: "RSI_OVERBOUGHT",
    };
  }

  let failDetail = "NO_SIGNAL";
  if (snapshot.rsi >= buyRsiMax) {
    failDetail = "RSI_NOT_OVERSOLD";
  } else if (!gtWithTolerance(snapshot.emaFast, snapshot.emaSlow)) {
    failDetail = "EMA_NOT_CROSSED";
  } else if (!gteWithTolerance(snapshot.latestPrice, snapshot.ema50)) {
    failDetail = "PRICE_BELOW_EMA50";
  } else if (
    !gteWithTolerance(snapshot.latestPrice, snapshot.ema200) &&
    !isTrendingOrBullishSnapshot(snapshot)
  ) {
    failDetail = "PRICE_BELOW_EMA200";
  } else if (!gteWithTolerance(snapshot.latestPrice, snapshot.ema200)) {
    failDetail = "PRICE_BELOW_EMA200_TRENDING_CONTEXT";
  }
  return {
    signal: "HOLD",
    strategy_reason: "strategy_no_entry_signal",
    strategy_fail_detail: failDetail,
  };
}
