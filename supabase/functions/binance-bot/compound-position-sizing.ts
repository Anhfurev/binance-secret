// @ts-nocheck
/** Wallet-compounding position size: fixed % of available balance per entry. */

import { clamp, toNumber } from "./utils.ts";

export const DEFAULT_COMPOUND_POSITION_PCT = 40;

/** `COMPOUND_POSITION_PCT` (default 40). Set `0` to use `trade_size_usd` / `risk_percent` from DB. */
export function readCompoundPositionPct(): number {
  const raw = String(Deno.env.get("COMPOUND_POSITION_PCT") ?? "").trim();
  if (!raw.length) return DEFAULT_COMPOUND_POSITION_PCT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_COMPOUND_POSITION_PCT;
  return clamp(n, 0, 100);
}

/** Trade notional = `walletBalance * (pct / 100)` when compounding is enabled. */
export function resolveCompoundTradeSizeUsd(walletBalance: number): number | null {
  const pct = readCompoundPositionPct();
  if (pct <= 0) return null;
  const balance = Math.max(0, toNumber(walletBalance, 0));
  if (balance <= 0) return null;
  return balance * (pct / 100);
}
