export function hasValidNonZeroEma(snapshot: {
  emaFast: number;
  emaSlow: number;
  ema200: number;
}) {
  return Number.isFinite(snapshot.emaFast) &&
    Number.isFinite(snapshot.emaSlow) &&
    Number.isFinite(snapshot.ema200) &&
    snapshot.emaFast > 0 &&
    snapshot.emaSlow > 0 &&
    snapshot.ema200 > 0;
}
