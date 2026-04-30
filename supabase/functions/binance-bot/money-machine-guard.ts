// @ts-nocheck
/**
 * Pre-AI math exits: hard -2% stop and a simple +3%/+1% lock trail (no LLM).
 * Uses trade.extra high-water when present so the trail arms after a real +3% excursion.
 */
import type { OpenTradeRow } from "./types.ts";
import { toNumber } from "./utils.ts";

const HARD_STOP_LOSS_FRAC = 0.02;
const TRAIL_ARM_GAIN_FRAC = 0.03;
const TRAIL_LOCK_FRAC = 0.01;

export type MoneyMachineExitHint = {
  /** Skip Gemini/Groq when exit is driven purely by these rules. */
  skipAi: boolean;
  forceExit: boolean;
  reason: string | null;
};

export function evaluateMoneyMachineExits(params: {
  openTrade: OpenTradeRow | null;
  price: number;
}): MoneyMachineExitHint {
  const { openTrade, price } = params;
  if (!openTrade) {
    return { skipAi: false, forceExit: false, reason: null };
  }
  const entry = toNumber(openTrade.entryPrice, 0);
  if (!(entry > 0) || !(price > 0)) {
    return { skipAi: false, forceExit: false, reason: null };
  }
  const pnlFrac = (price - entry) / entry;
  if (pnlFrac <= -HARD_STOP_LOSS_FRAC) {
    return {
      skipAi: true,
      forceExit: true,
      reason: "money_machine_hard_stop_2pct",
    };
  }
  const extra = (openTrade as { extra?: Record<string, unknown> }).extra ?? {};
  const highSeen = Math.max(
    toNumber(extra.highest_price_seen, entry),
    toNumber(extra.highest_price_reached, entry),
    entry,
  );
  const peakGainFromEntry = (highSeen - entry) / entry;
  const trailArmed = peakGainFromEntry >= TRAIL_ARM_GAIN_FRAC;
  const floorPrice = entry * (1 + TRAIL_LOCK_FRAC);
  if (trailArmed && price < floorPrice) {
    return {
      skipAi: true,
      forceExit: true,
      reason: "money_machine_trailing_lock_1pct_after_3pct_run",
    };
  }
  return { skipAi: false, forceExit: false, reason: null };
}
