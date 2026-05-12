// @ts-nocheck
import { resolvePaperTakerFeeSimulationPct } from "./constants.ts";
import { toNumber } from "./utils.ts";

export function extractLegFeeUsd(order: Record<string, unknown>): number {
  const meta = (order as { smart_execution_meta?: Record<string, unknown> })
    ?.smart_execution_meta;
  const fromMeta = toNumber(meta?.fee_usd, NaN);
  if (Number.isFinite(fromMeta) && fromMeta >= 0) {
    return Number(fromMeta.toFixed(8));
  }
  const amt = toNumber((order as { amount?: unknown }).amount, NaN);
  const px = toNumber(
    (order as { average?: unknown }).average ?? (order as { price?: unknown }).price,
    NaN,
  );
  if (Number.isFinite(amt) && amt > 0 && Number.isFinite(px) && px > 0) {
    const feePct = resolvePaperTakerFeeSimulationPct();
    return Number((amt * px * feePct).toFixed(8));
  }
  return 0;
}

export function resolveFillVwap(order: Record<string, unknown>, fallback: number): number {
  const fillAvg = toNumber(
    (order as { average?: unknown }).average ?? (order as { price?: unknown }).price,
    NaN,
  );
  if (Number.isFinite(fillAvg) && fillAvg > 0) {
    return Number(fillAvg.toFixed(8));
  }
  return Number(fallback.toFixed(8));
}

export function computeNetTradePnl(params: {
  qty: number;
  entryPrice: number;
  exitPrice: number;
  feeUsdBuy: number;
  feeUsdSell: number;
}): number {
  const gross = params.qty * (params.exitPrice - params.entryPrice);
  return Number((gross - params.feeUsdBuy - params.feeUsdSell).toFixed(8));
}
