// @ts-nocheck
import type { IndicatorSnapshot } from "./types.ts";
import { toNumber } from "./utils.ts";

export type SmartNoiseFilterResult = {
  sleepAi: boolean;
  blockBuy: boolean;
  vetoReasons: string[];
  blockReason: string | null;
  volume1m: number;
  avgVolume1mFrom24h: number | null;
  spreadBps: number | null;
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

function readMaxSpreadBps(symbol: string): number {
  const sym = String(symbol ?? "").toUpperCase();
  const perSymbol = String(Deno.env.get(`SMART_FILTER_MAX_SPREAD_BPS_${sym}`) ?? "").trim();
  const perSymbolN = perSymbol.length ? Number(perSymbol) : NaN;
  if (Number.isFinite(perSymbolN)) {
    return Math.min(500, Math.max(1, Math.floor(perSymbolN)));
  }
  const raw = String(Deno.env.get("SMART_FILTER_MAX_SPREAD_BPS") ?? "").trim();
  const n = raw.length ? Number(raw) : NaN;
  if (Number.isFinite(n)) {
    return Math.min(500, Math.max(1, Math.floor(n)));
  }
  if (sym.includes("PEPE")) return 80;
  if (sym.includes("SOL")) return 14;
  return 10;
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
}): SmartNoiseFilterResult {
  const { snapshot, lastCandleVolume, hasOpenTrade, isGhostExecution = false } = params;
  const volume1m = Math.max(0, toNumber(lastCandleVolume, 0));
  const avgVolume1mFrom24h = resolveAvgVolume1mFrom24h(snapshot);
  const spreadBps = Number.isFinite(snapshot.spreadBps ?? NaN)
    ? Number(snapshot.spreadBps)
    : null;

  if (!readEnabled() || isGhostExecution) {
    return {
      sleepAi: false,
      blockBuy: false,
      vetoReasons: [],
      blockReason: null,
      volume1m,
      avgVolume1mFrom24h,
      spreadBps,
    };
  }

  const vetoReasons: string[] = [];
  let sleepAi = false;
  let blockBuy = false;
  let blockReason: string | null = null;

  if (!hasOpenTrade && avgVolume1mFrom24h != null && avgVolume1mFrom24h > 0) {
    const minRatio = readMinVolVs24hAvg();
    if (volume1m < avgVolume1mFrom24h * minRatio) {
      sleepAi = true;
      vetoReasons.push("FAIL_LOW_VOLUME_VS_24H_AVG");
    }
  }

  if (!hasOpenTrade && spreadBps != null && spreadBps > 0) {
    const maxSpreadBps = readMaxSpreadBps(snapshot.symbol);
    if (spreadBps > maxSpreadBps) {
      blockBuy = true;
      blockReason = `hold_wide_spread_${spreadBps.toFixed(2)}bps_gt_${maxSpreadBps}`;
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
  };
}
