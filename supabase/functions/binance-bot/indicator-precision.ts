// @ts-nocheck
/** Float hygiene for fractional spot tapes (PEPE, SHIB, …) — math vs logs. */

/** Below ref × ratio (or absolute floor), logs use `toExponential` instead of rounding to 0. */
const LOG_UNDERFLOW_RATIO = 1e-4;
const LOG_ABSOLUTE_UNDERFLOW = 1e-11;

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

export function resolveIndicatorLogReference(
  value: number,
  referencePrice?: number,
): number {
  const ref = Number(referencePrice);
  if (Number.isFinite(ref) && ref > 0) return ref;
  const abs = Math.abs(value);
  return abs > 0 ? abs : 1;
}

export function shouldUseExponentialIndicatorDisplay(
  value: number,
  referencePrice?: number,
): boolean {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return false;
  const ref = resolveIndicatorLogReference(n, referencePrice);
  const abs = Math.abs(n);
  if (abs < LOG_ABSOLUTE_UNDERFLOW) return true;
  return abs < Math.max(LOG_ABSOLUTE_UNDERFLOW, ref * LOG_UNDERFLOW_RATIO);
}

/** Log / Telegram display only — never use for strategy gates. */
export function formatIndicatorForLog(
  value: unknown,
  referencePrice?: number,
): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "n/a";
  const ref = resolveIndicatorLogReference(n, referencePrice);
  if (shouldUseExponentialIndicatorDisplay(n, ref)) {
    return n.toExponential(6);
  }
  const digits = resolveIndicatorDisplayDecimals(ref);
  if (n === 0) return (0).toFixed(digits);
  return n.toFixed(digits);
}

/** Generic numeric log field (RSI, confidence, …) with optional tape ref for micro values. */
export function formatLogNumber(
  value: unknown,
  fallbackDigits = 2,
  referencePrice?: number,
): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "n/a";
  if (shouldUseExponentialIndicatorDisplay(n, referencePrice)) {
    return n.toExponential(4);
  }
  return n.toFixed(fallbackDigits);
}

/** JSON-safe log meta: raw number + display string (avoids 0.00000000 underflow in dashboards). */
export function indicatorLogField(
  value: unknown,
  referencePrice?: number,
): { raw: number | null; display: string } {
  const n = Number(value);
  if (!Number.isFinite(n)) return { raw: null, display: "n/a" };
  return { raw: n, display: formatIndicatorForLog(n, referencePrice) };
}

export function indicatorFieldsForLogMeta(
  snapshot: Record<string, unknown>,
  keys: string[],
): Record<string, { raw: number | null; display: string }> {
  const ref = Number(snapshot.latestPrice ?? snapshot.price ?? 0);
  const out: Record<string, { raw: number | null; display: string }> = {};
  for (const key of keys) {
    out[key] = indicatorLogField(snapshot[key], ref);
  }
  return out;
}
