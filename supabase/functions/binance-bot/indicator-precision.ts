// @ts-nocheck
/** Float hygiene for fractional spot tapes (PEPE, SHIB, …) — math vs logs. */

export function sanitizeIndicatorFloat(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Minimum positive magnitude for EMA/price sanity checks at a given tape scale. */
export function minPositiveIndicatorMagnitude(referencePrice: number): number {
  const p = Number(referencePrice);
  if (!Number.isFinite(p) || p <= 0) return 1e-12;
  return Math.max(1e-12, p * 1e-8);
}

export function resolveIndicatorDisplayDecimals(referencePrice?: number): number {
  const p = Number(referencePrice);
  if (!Number.isFinite(p) || p <= 0) {
    return 8;
  }
  if (p < 0.01) return 8;
  if (p < 1) return 6;
  if (p < 100) return 4;
  return 2;
}

/** Log / Telegram display only — never use for strategy gates. */
export function formatIndicatorForLog(
  value: unknown,
  referencePrice?: number,
): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "n/a";
  const ref = Number.isFinite(Number(referencePrice)) && Number(referencePrice) > 0
    ? Number(referencePrice)
    : Math.abs(n);
  const digits = resolveIndicatorDisplayDecimals(ref);
  if (n === 0) return (0).toFixed(digits);
  return n.toFixed(digits);
}
