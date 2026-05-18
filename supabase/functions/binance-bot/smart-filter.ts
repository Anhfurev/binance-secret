// @ts-nocheck
import type { IndicatorSnapshot } from "./types.ts";
import { toNumber } from "./utils.ts";
import {
  resolveRegimeMaxSpreadBps,
  resolveRegimeScalingFloors,
  resolveTradeRegime,
  type TradeRegime,
} from "./regime-scaling.ts";
import { readActiveFrictionSpreadBoost } from "./professional-expectancy.ts";
import { resolveScaledSmartFilterFloors } from "./strategy-hybrid-gates.ts";
import { resolveSmartFilterVolumeGatePolicy } from "./smart-filter-volume-policy.ts";

export type SmartNoiseFilterResult = {
  sleepAi: boolean;
  blockBuy: boolean;
  vetoReasons: string[];
  blockReason: string | null;
  volume1m: number;
  avgVolume1mFrom24h: number | null;
  spreadBps: number | null;
  tradeRegime: TradeRegime;
  volume1mQuoteUsd: number;
  volumeGateMode: string;
  minVolume1mQuoteUsdApplied: number;
};

function readEnabled(): boolean {
  const flag = String(Deno.env.get("SMART_FILTER_ENABLED") ?? "1").trim().toLowerCase();
  return flag !== "0" && flag !== "false";
}

function readMinVolVs24hAvg(): number {
  const raw = String(Deno.env.get("SMART_FILTER_MIN_VOL_VS_24H_AVG") ?? "").trim();
  const n = raw.length ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 0.45;
  return Math.min(3, Math.max(0.1, n));
}

export function isCapitulationTape(snapshot: IndicatorSnapshot): boolean {
  const rsi = toNumber(snapshot.rsi, 50);
  const px = toNumber(snapshot.latestPrice, 0);
  const bbLow = toNumber(snapshot.bbLower, 0);
  const nearLowerBand =
    bbLow > 0 && px > 0 && px <= bbLow * 1.015;
  return rsi > 0 && rsi < 38 && nearLowerBand;
}

export function resolveEffectiveMinVolRatio(params: {
  snapshot: IndicatorSnapshot;
  baseRatio: number;
  volume1m: number;
  avgFrom24h: number;
}): number {
  let ratio = params.baseRatio;
  if (isCapitulationTape(params.snapshot)) {
    ratio = Math.min(ratio, 0.22);
  }
  const burst =
    params.avgFrom24h > 0 ? params.volume1m / params.avgFrom24h : 0;
  if (burst >= 1.8) {
    ratio = Math.min(ratio, 0.28);
  }
  return ratio;
}

export function resolveAvgVolume1mFrom24h(snapshot: IndicatorSnapshot): number | null {
  const base24h = toNumber(snapshot.volume24hBase, 0);
  if (base24h > 0) return base24h / 1440;
  const quote24h = toNumber(snapshot.volume24hQuote, 0);
  const px = toNumber(snapshot.latestPrice, 0);
  if (quote24h > 0 && px > 0) return (quote24h / px) / 1440;
  const avg = toNumber(snapshot.avgVolume1m, 0);
  return avg > 0 ? avg : null;
}

export function evaluateSmartNoiseFilter(params: {
  snapshot: IndicatorSnapshot;
  lastCandleVolume: number;
  hasOpenTrade: boolean;
  isGhostExecution?: boolean;
  paperRelaxed?: boolean;
  /** From `bot_settings.min_volume_24h_quote` — high-liq pairs prefer this over 1m burst gates. */
  minVolume24hQuoteFromDb?: number;
}): SmartNoiseFilterResult {
  const {
    snapshot,
    lastCandleVolume,
    hasOpenTrade,
    isGhostExecution = false,
    paperRelaxed = false,
    minVolume24hQuoteFromDb = 0,
  } = params;
  const volume1m = Math.max(0, toNumber(lastCandleVolume, 0));
  const latestPrice = toNumber(snapshot.latestPrice, 0);
  const volume1mQuoteUsd = latestPrice > 0 ? volume1m * latestPrice : 0;
  const avgVolume1mFrom24h = resolveAvgVolume1mFrom24h(snapshot);
  const spreadBps = Number.isFinite(snapshot.spreadBps ?? NaN)
    ? Number(snapshot.spreadBps)
    : null;
  const tradeRegime = resolveTradeRegime(
    snapshot.symbol,
    latestPrice,
    toNumber(snapshot.atr14, 0),
  );
  const floors = resolveRegimeScalingFloors(tradeRegime);

  if (!readEnabled() || isGhostExecution) {
    return {
      sleepAi: false,
      blockBuy: false,
      vetoReasons: [],
      blockReason: null,
      volume1m,
      avgVolume1mFrom24h,
      spreadBps,
      tradeRegime,
      volume1mQuoteUsd,
      volumeGateMode: "disabled",
      minVolume1mQuoteUsdApplied: 0,
    };
  }

  const vetoReasons: string[] = [];
  let sleepAi = false;
  let blockBuy = false;
  let blockReason: string | null = null;

  const scaledFloors = resolveScaledSmartFilterFloors({
    snapshot,
    tradeRegime,
    baseMinVolVs24hAvg: readMinVolVs24hAvg(),
    baseMinVolume1mQuoteUsd: floors.minVolume1mQuoteUsd,
  });
  const minVolRatio = paperRelaxed
    ? Math.min(scaledFloors.minVolVs24hAvg, 0.32)
    : scaledFloors.minVolVs24hAvg;
  const volumeGate = resolveSmartFilterVolumeGatePolicy({
    symbol: snapshot.symbol,
    baseMinVolume1mQuoteUsd: scaledFloors.minVolume1mQuoteUsd,
    minVolume24hQuoteFromDb,
    snapshot,
  });
  const minVolume1mQuoteUsd = volumeGate.minVolume1mQuoteUsd;

  if (volumeGate.mode !== "standard") {
    console.log("[SMART_FILTER_VOLUME]", {
      symbol: snapshot.symbol,
      mode: volumeGate.mode,
      base_1m_floor_usd: scaledFloors.minVolume1mQuoteUsd,
      applied_1m_floor_usd: minVolume1mQuoteUsd,
      min_volume_24h_quote_db: volumeGate.minVolume24hQuoteDb,
      volume_24h_quote: volumeGate.volume24hQuote,
      skip_1m_usd: volumeGate.skip1mUsdGate,
      skip_1m_vs_24h_avg: volumeGate.skip1mVs24hAvgGate,
    });
  }

  if (
    !hasOpenTrade
    && !volumeGate.skip1mVs24hAvgGate
    && avgVolume1mFrom24h != null
    && avgVolume1mFrom24h > 0
  ) {
    const effectiveMinVolRatio = resolveEffectiveMinVolRatio({
      snapshot,
      baseRatio: minVolRatio,
      volume1m,
      avgFrom24h: avgVolume1mFrom24h,
    });
    if (volume1m < avgVolume1mFrom24h * effectiveMinVolRatio) {
      sleepAi = true;
      vetoReasons.push("FAIL_LOW_VOLUME_VS_24H_AVG");
    }
  }

  if (
    !hasOpenTrade
    && !volumeGate.skip1mUsdGate
    && minVolume1mQuoteUsd > 0
    && volume1mQuoteUsd < minVolume1mQuoteUsd
  ) {
    blockBuy = true;
    blockReason =
      `hold_low_1m_volume_${volume1mQuoteUsd.toFixed(0)}usd_lt_${minVolume1mQuoteUsd}`;
    vetoReasons.push("FAIL_LOW_1M_VOLUME_USD");
  }

  if (!hasOpenTrade && spreadBps != null && spreadBps > 0) {
    const frictionBoost = readActiveFrictionSpreadBoost();
    const maxSpreadBps = resolveRegimeMaxSpreadBps(snapshot.symbol, tradeRegime) + frictionBoost;
    if (spreadBps > maxSpreadBps) {
      blockBuy = true;
      blockReason = frictionBoost > 0
        ? `hold_wide_spread_${spreadBps.toFixed(2)}bps_gt_${maxSpreadBps}_friction_boost_${frictionBoost}`
        : `hold_wide_spread_${spreadBps.toFixed(2)}bps_gt_${maxSpreadBps}`;
      vetoReasons.push("FAIL_WIDE_SPREAD");
    }
  }

  return {
    sleepAi,
    blockBuy,
    vetoReasons,
    blockReason,
    volume1m,
    avgVolume1mFrom24h,
    spreadBps,
    tradeRegime,
    volume1mQuoteUsd,
    volumeGateMode: volumeGate.mode,
    minVolume1mQuoteUsdApplied: minVolume1mQuoteUsd,
  };
}
