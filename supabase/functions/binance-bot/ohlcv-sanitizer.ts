// @ts-nocheck
import type { Candle } from "./types.ts";
import { toNumber } from "./utils.ts";

type RawOhlcvEntry = Array<number | string | null | undefined>;

function sanitizePrice(value: unknown, fallback: number): number {
  const n = toNumber(value, NaN);
  if (Number.isFinite(n) && n > 0) return n;
  return fallback > 0 ? fallback : 0;
}

function sanitizeVolume(value: unknown, fallback: number): number {
  const n = toNumber(value, NaN);
  if (Number.isFinite(n) && n >= 0) return n;
  return Math.max(0, fallback);
}

/**
 * Carry-forward sanitizer for sparse/micro tapes:
 * - Invalid or zero price fields inherit the previous valid close.
 * - Invalid volume inherits previous valid volume (supports 0-volume gaps).
 */
export function sanitizeOhlcvCandles(raw: RawOhlcvEntry[]): Candle[] {
  const out: Candle[] = [];
  let prevClose = 0;
  let prevVolume = 0;

  for (const entry of raw ?? []) {
    const openTime = toNumber(entry?.[0], 0);
    if (!openTime) continue;

    const close = sanitizePrice(entry?.[4], prevClose);
    if (!(close > 0)) continue;

    const open = sanitizePrice(entry?.[1], prevClose || close);
    const highCandidate = sanitizePrice(entry?.[2], Math.max(open, close));
    const lowCandidate = sanitizePrice(entry?.[3], Math.min(open, close));
    const high = Math.max(open, close, highCandidate);
    const low = Math.min(open, close, lowCandidate);
    const volume = sanitizeVolume(entry?.[5], prevVolume);

    out.push({ openTime, open, high, low, close, volume });
    prevClose = close;
    prevVolume = volume;
  }
  return out;
}
