// @ts-nocheck
import type { IndicatorSnapshot } from "./types.ts";
import { readMinAdxForNonTrendingBuy } from "./buy-helpers.ts";

export function evaluateChopBuyBlock(params: {
  snapshot: IndicatorSnapshot;
  paperLiveStyle: boolean;
  enabled: boolean;
}): { block: boolean; reason: string | null } {
  if (!params.enabled) return { block: false, reason: null };
  const adx = Number(params.snapshot.adx14);
  const minAdx = readMinAdxForNonTrendingBuy(params.paperLiveStyle);
  const price = Number(params.snapshot.latestPrice);
  const ema50 = Number(params.snapshot.ema50 ?? params.snapshot.emaSlow ?? 0);
  const ema200 = Number(params.snapshot.ema200 ?? 0);
  const regime = String(params.snapshot.marketRegime ?? "");
  const mtfOk = Boolean(params.snapshot.trend_htf?.mtf_effective_ok);
  if (regime !== "TRENDING" && Number.isFinite(adx) && adx < minAdx) {
    return {
      block: true,
      reason: `hold_low_adx_chop (adx=${adx.toFixed(2)}<${minAdx})`,
    };
  }
  if (params.paperLiveStyle && ema200 > 0 && price < ema200 * 0.998 && !mtfOk) {
    return { block: true, reason: "hold_chop_below_ema200_no_mtf" };
  }
  if (
    params.paperLiveStyle &&
    ema50 > 0 &&
    price < ema50 * 0.995 &&
    Number.isFinite(adx) &&
    adx < minAdx + 4
  ) {
    return { block: true, reason: "hold_chop_below_ema50" };
  }
  return { block: false, reason: null };
}
