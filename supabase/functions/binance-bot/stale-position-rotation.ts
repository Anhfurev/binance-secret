// @ts-nocheck
/**
 * Rotate capital out of stale legs — flat / going nowhere after N hours (small-account mode).
 */
import type { OpenTradeRow } from "./types.ts";
import { toNumber } from "./utils.ts";
import {
  resolveOpenTradeEntryPrice,
  resolveOpenTradeOpenedAtMs,
} from "./trade-row-helpers.ts";

export type StalePositionExitHint = {
  forceExit: boolean;
  skipAi: boolean;
  reason: string | null;
  ageHours: number | null;
  pnlPct: number | null;
};

function readStalePositionHours(): number {
  const raw = String(
    Deno.env.get("LIVE_STALE_POSITION_HOURS") ??
      Deno.env.get("STALE_POSITION_HOURS") ??
      "24",
  ).trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 24;
  return Math.min(168, Math.floor(n));
}

function readStaleFlatExitPnlPct(): number {
  const raw = String(Deno.env.get("STALE_FLAT_EXIT_PNL_PCT") ?? "1.5").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1.5;
  return Math.min(5, Math.max(0.25, n));
}

function readStaleMinPeakPct(): number {
  const raw = String(Deno.env.get("STALE_MIN_PEAK_PCT") ?? "0.75").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0.75;
  return Math.min(3, Math.max(0.1, n));
}

/** Exit when age ≥ threshold and tape is flat or never reached min progress. */
export function evaluateStalePositionRotation(params: {
  openTrade: OpenTradeRow | null;
  price: number;
  nowMs?: number;
}): StalePositionExitHint {
  const empty: StalePositionExitHint = {
    forceExit: false,
    skipAi: false,
    reason: null,
    ageHours: null,
    pnlPct: null,
  };
  const { openTrade, price, nowMs = Date.now() } = params;
  if (!openTrade || !(price > 0)) return empty;

  const openedMs = resolveOpenTradeOpenedAtMs(openTrade);
  if (openedMs == null) return empty;

  const ageHours = (nowMs - openedMs) / (60 * 60 * 1000);
  const staleHours = readStalePositionHours();
  if (ageHours < staleHours) {
    return { ...empty, ageHours: Number(ageHours.toFixed(2)) };
  }

  const entry = resolveOpenTradeEntryPrice(openTrade);
  if (!(entry > 0)) return { ...empty, ageHours: Number(ageHours.toFixed(2)) };

  const pnlPct = ((price - entry) / entry) * 100;
  const extra = (openTrade.extra as Record<string, unknown> | undefined) ?? {};
  const highSeen = Math.max(
    price,
    toNumber(extra.highest_price_seen, entry),
    toNumber(extra.highest_price_reached, entry),
    entry,
  );
  const peakPct = ((highSeen - entry) / entry) * 100;
  const flatBand = readStaleFlatExitPnlPct();
  const minPeak = readStaleMinPeakPct();

  if (Math.abs(pnlPct) <= flatBand) {
    return {
      forceExit: true,
      skipAi: true,
      reason: "stale_flat_rotation",
      ageHours: Number(ageHours.toFixed(2)),
      pnlPct: Number(pnlPct.toFixed(3)),
    };
  }

  if (peakPct < minPeak && pnlPct < minPeak) {
    return {
      forceExit: true,
      skipAi: true,
      reason: "stale_underperform_rotation",
      ageHours: Number(ageHours.toFixed(2)),
      pnlPct: Number(pnlPct.toFixed(3)),
    };
  }

  return {
    forceExit: false,
    skipAi: false,
    reason: null,
    ageHours: Number(ageHours.toFixed(2)),
    pnlPct: Number(pnlPct.toFixed(3)),
  };
}
