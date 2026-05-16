// @ts-nocheck
import type { IndicatorSnapshot } from "./types.ts";

/** RSI below this = prime mean-reversion bounce (`STRATEGY_DEEP_OVERSOLD_RSI`, default 35). */
export function readDeepOversoldRsiThreshold(): number {
  const raw = Number(Deno.env.get("STRATEGY_DEEP_OVERSOLD_RSI") ?? "35");
  if (!Number.isFinite(raw)) return 35;
  return Math.min(45, Math.max(20, Math.floor(raw)));
}

export function isDeepOversoldRsi(rsi: number): boolean {
  return Number.isFinite(rsi) && rsi > 0 && rsi < readDeepOversoldRsiThreshold();
}

export function isOversoldBounceStrategyReason(reason: string | undefined | null): boolean {
  return String(reason ?? "") === "strategy_oversold_bounce_entry";
}

/** Active when deep RSI or strategy tagged a bounce entry this cycle. */
export function isOversoldBounceContext(
  snapshot: Pick<IndicatorSnapshot, "rsi">,
  strategyReason?: string | null,
): boolean {
  return isDeepOversoldRsi(Number(snapshot.rsi)) ||
    isOversoldBounceStrategyReason(strategyReason);
}

function readOversoldMinTechDelta(): number {
  const raw = Number(Deno.env.get("OVERSOLD_BOUNCE_MIN_TECH_DELTA") ?? "2");
  if (!Number.isFinite(raw) || raw < 0) return 2;
  return Math.min(5, Math.floor(raw));
}

function readOversoldMinTechFloor(): number {
  const raw = Number(Deno.env.get("OVERSOLD_BOUNCE_MIN_TECH_FLOOR") ?? "3");
  if (!Number.isFinite(raw)) return 3;
  return Math.min(8, Math.max(1, Math.floor(raw)));
}

/**
 * Lowers inclusive `min_tech_score` during oversold bounce so bearish macro (EMA200) does not
 * block entries that already passed `strategy_oversold_bounce_entry`.
 */
export function resolveMinTechForOversoldBounce(
  baseMinTech: number,
  snapshot: Pick<IndicatorSnapshot, "rsi">,
  strategyReason?: string | null,
): number {
  if (!isOversoldBounceContext(snapshot, strategyReason)) return baseMinTech;
  const relaxed = Math.max(
    readOversoldMinTechFloor(),
    Math.floor(baseMinTech) - readOversoldMinTechDelta(),
  );
  return Math.min(baseMinTech, relaxed);
}
