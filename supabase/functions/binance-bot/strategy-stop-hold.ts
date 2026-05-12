// @ts-nocheck
import type { OpenTradeRow } from "./types.ts";

export function readMinHoldBeforeDbStopMs(): number {
  const raw = String(Deno.env.get("MIN_HOLD_BEFORE_DB_STOP_MS") ?? "240000").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 180_000;
  return Math.min(15 * 60 * 1000, Math.floor(n));
}

export function canFireDbStopLoss(
  openTrade: OpenTradeRow,
  nowMs = Date.now(),
): boolean {
  const minHoldMs = readMinHoldBeforeDbStopMs();
  if (minHoldMs <= 0) return true;
  const openedAt = Date.parse(String(openTrade.opened_at ?? ""));
  if (!Number.isFinite(openedAt)) return false;
  return nowMs - openedAt >= minHoldMs;
}
