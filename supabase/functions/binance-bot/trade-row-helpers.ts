// @ts-nocheck
import type { OpenTradeRow } from "./types.ts";
import { toNumber } from "./utils.ts";

/** DB rows may expose `entryPrice` and/or `entry_price`. */
export function resolveOpenTradeEntryPrice(
  openTrade: OpenTradeRow | null | undefined,
  fallback = 0,
): number {
  if (!openTrade) return fallback;
  const row = openTrade as Record<string, unknown>;
  const direct = toNumber(openTrade.entryPrice, NaN);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const snake = toNumber(row.entry_price, NaN);
  if (Number.isFinite(snake) && snake > 0) return snake;
  const legacy = toNumber(row.price, NaN);
  if (Number.isFinite(legacy) && legacy > 0) return legacy;
  return fallback;
}

export function resolveOpenTradeOpenedAtMs(openTrade: OpenTradeRow | null | undefined): number | null {
  if (!openTrade) return null;
  const row = openTrade as Record<string, unknown>;
  const raw = String(openTrade.opened_at ?? row.opened_at ?? openTrade.created_at ?? row.created_at ?? "");
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}
