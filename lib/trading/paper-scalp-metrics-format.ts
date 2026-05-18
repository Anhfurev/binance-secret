/** High-precision USD / micro-cap price formatting for paper NAV & P&L. */

export const NAV_USD_DECIMALS = 4;

export function formatNavUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(NAV_USD_DECIMALS);
}

export function formatSignedNavUsd(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}$${formatNavUsd(value)}`;
}

export function formatPct4(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(4)}%`;
}

/** Asset marks: 8 decimals below $1 so PEPE micro-moves are visible. */
export function formatAssetPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const p = Math.abs(value);
  if (p >= 1) return value.toFixed(4);
  return value.toFixed(8);
}
