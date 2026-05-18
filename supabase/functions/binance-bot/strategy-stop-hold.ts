// @ts-nocheck
import { resolveAssetMinSoftExitHoldMs } from "./asset-risk-profile.ts";
import type { OpenTradeRow } from "./types.ts";

export function readMinHoldBeforeDbStopMs(): number {
  const raw = String(Deno.env.get("MIN_HOLD_BEFORE_DB_STOP_MS") ?? "240000").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 240_000;
  return Math.min(15 * 60 * 1000, Math.floor(n));
}

function tradeAgeMs(openTrade: OpenTradeRow, nowMs: number): number | null {
  const openedAt = Date.parse(String(openTrade.opened_at ?? ""));
  if (!Number.isFinite(openedAt)) return null;
  return nowMs - openedAt;
}

export function canFireDbStopLoss(
  openTrade: OpenTradeRow,
  nowMs = Date.now(),
): boolean {
  const minHoldMs = readMinHoldBeforeDbStopMs();
  if (minHoldMs <= 0) return true;
  const age = tradeAgeMs(openTrade, nowMs);
  if (age == null) return false;
  return age >= minHoldMs;
}

/** Blocks signal_exit, rsi_overbought, and matrix soft SELLs until asset min hold elapses. */
export function canFireSoftSignalExit(
  openTrade: OpenTradeRow,
  symbol: string,
  nowMs = Date.now(),
): boolean {
  const minHoldMs = resolveAssetMinSoftExitHoldMs(symbol);
  if (minHoldMs <= 0) return true;
  const age = tradeAgeMs(openTrade, nowMs);
  if (age == null) return false;
  return age >= minHoldMs;
}
