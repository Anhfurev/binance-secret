// @ts-nocheck
/**
 * Pre-AI math exits: trailing lock (hard stops defer to DB `stopLoss` + strategy).
 */
import type { OpenTradeRow } from "./types.ts";
import { toNumber } from "./utils.ts";
import { canFireDbStopLoss } from "./strategy-stop-hold.ts";
import {
  hasDbStopLossPrice,
  resolveHardStopLossFrac,
} from "./trade-stop-risk.ts";

function readPctFrac(key: string, fallbackPct: number): number {
  const raw = String(Deno.env.get(key) ?? "").trim();
  const n = raw.length ? Number(raw) : fallbackPct;
  if (!Number.isFinite(n) || n <= 0) return fallbackPct / 100;
  return Math.min(0.1, Math.max(0.001, n / 100));
}

const HARD_STOP_LOSS_FRAC = readPctFrac("MONEY_MACHINE_HARD_STOP_PCT", 0.05);
const TRAIL_ARM_GAIN_FRAC = readPctFrac("MONEY_MACHINE_TRAIL_ARM_PCT", 0.95);
const TRAIL_LOCK_FRAC = readPctFrac("MONEY_MACHINE_TRAIL_LOCK_PCT", 0.35);

export type MoneyMachineExitHint = {
  /** Skip Gemini/Groq when exit is driven purely by these rules. */
  skipAi: boolean;
  forceExit: boolean;
  reason: string | null;
};

export function evaluateMoneyMachineExits(params: {
  openTrade: OpenTradeRow | null;
  price: number;
  nowMs?: number;
}): MoneyMachineExitHint {
  const { openTrade, price, nowMs = Date.now() } = params;
  if (!openTrade) {
    return { skipAi: false, forceExit: false, reason: null };
  }
  const entry = toNumber(openTrade.entryPrice, 0);
  if (!(entry > 0) || !(price > 0)) {
    return { skipAi: false, forceExit: false, reason: null };
  }
  const pnlFrac = (price - entry) / entry;
  const extra = (openTrade as { extra?: Record<string, unknown> }).extra ?? {};
  const highSeen = Math.max(
    price,
    toNumber(extra.highest_price_seen, entry),
    toNumber(extra.highest_price_reached, entry),
    entry,
  );
  const peakGainFromEntry = (highSeen - entry) / entry;
  const trailArmed = peakGainFromEntry >= TRAIL_ARM_GAIN_FRAC;
  const floorPrice = entry * (1 + TRAIL_LOCK_FRAC);
  if (!hasDbStopLossPrice(openTrade)) {
    const hardStopFrac = resolveHardStopLossFrac(openTrade, entry, HARD_STOP_LOSS_FRAC);
    if (pnlFrac <= -hardStopFrac) {
      if (!canFireDbStopLoss(openTrade, nowMs)) {
        return { skipAi: false, forceExit: false, reason: null };
      }
      return {
        skipAi: true,
        forceExit: true,
        reason: "money_machine_hard_stop",
      };
    }
  }
  if (trailArmed && price < floorPrice) {
    return {
      skipAi: true,
      forceExit: true,
      reason: "money_machine_trailing_lock",
    };
  }
  return { skipAi: false, forceExit: false, reason: null };
}
