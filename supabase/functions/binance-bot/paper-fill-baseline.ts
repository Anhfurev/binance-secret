// @ts-nocheck
/** Pure bid/ask baseline for paper fills (unit-tested). */

export function resolveBookBaseline(params: {
  side: "buy" | "sell";
  signalPrice: number;
  bid?: number;
  ask?: number;
  last?: number;
}): { baseline: number; source: string } {
  const { side, signalPrice, bid, ask, last } = params;
  const b = Number(bid);
  const a = Number(ask);
  const l = Number(last);
  const ref = Number.isFinite(l) && l > 0 ? l : signalPrice;
  const half = 0.00035;
  if (side === "buy") {
    if (Number.isFinite(a) && a > 0) return { baseline: a, source: "ask" };
    if (Number.isFinite(b) && b > 0) {
      return { baseline: b, source: "bid_fallback_buy" };
    }
    return { baseline: ref * (1 + half), source: "last_plus_synth_half_spread" };
  }
  if (Number.isFinite(b) && b > 0) return { baseline: b, source: "bid" };
  if (Number.isFinite(a) && a > 0) {
    return { baseline: a, source: "ask_fallback_sell" };
  }
  return { baseline: ref * (1 - half), source: "last_minus_synth_half_spread" };
}
