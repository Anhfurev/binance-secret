/** Float-safe comparisons for EMA/price gates (strategy + technical score). */
export function gtWithTolerance(left: number, right: number, relEps = 1e-8): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const scale = Math.max(Number.EPSILON, Math.abs(left), Math.abs(right));
  return left - right > relEps * scale;
}

export function gteWithTolerance(left: number, right: number, relEps = 1e-8): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const scale = Math.max(Number.EPSILON, Math.abs(left), Math.abs(right));
  return left > right || Math.abs(left - right) <= relEps * scale;
}
