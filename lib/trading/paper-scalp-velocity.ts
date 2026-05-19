import type { Scalp1mSnapshot, ScalpCandle } from "@/lib/trading/paper-scalp-indicators";
import { normalizePaperSymbol } from "@/lib/trading/paper-scalp-mark-price";
import { computeRvol24h } from "@/lib/trading/paper-scalp-vwap";

export const VELOCITY_RSI_MIN = 60;
export const VELOCITY_RSI_MAX_SHORT = 40;
export const VELOCITY_RVOL_MIN = 2;
export const VELOCITY_LONG_CANDLE_PCT = 0.012;
export const VELOCITY_SHORT_CANDLE_PCT = -0.012;
export const VELOCITY_TP_GAIN_PCT = 0.015;
export const VELOCITY_PARTIAL_SELL_RATIO = 0.7;

export type VelocityBreakoutCandidate = {
  symbol: string;
  snap: Scalp1mSnapshot;
  rvol24h: number;
  candleVelocityPct: number;
};

function norm(sym: string): string {
  return normalizePaperSymbol(sym);
}

/** Latest 15m candle body move (open → close). */
export function resolveCandleVelocityPct(candles: ScalpCandle[]): number | null {
  const last = candles[candles.length - 1];
  if (!last || last.open <= 0) return null;
  return Number(((last.close - last.open) / last.open).toFixed(6));
}

export function evaluateVelocityBreakout(
  snap: Scalp1mSnapshot,
  candles: ScalpCandle[],
): { isVelocity: boolean; rvol24h: number; candleVelocityPct: number | null } {
  const rvol24h = computeRvol24h(candles);
  const candleVelocityPct = resolveCandleVelocityPct(candles);
  const pctHit =
    candleVelocityPct != null && candleVelocityPct >= VELOCITY_LONG_CANDLE_PCT;
  const isVelocity =
    pctHit ||
    (snap.rsi14 > VELOCITY_RSI_MIN && rvol24h > VELOCITY_RVOL_MIN);
  return { isVelocity, rvol24h, candleVelocityPct };
}

export function evaluateVelocityBreakdown(
  snap: Scalp1mSnapshot,
  candles: ScalpCandle[],
): { isVelocity: boolean; rvol24h: number; candleVelocityPct: number | null } {
  const rvol24h = computeRvol24h(candles);
  const candleVelocityPct = resolveCandleVelocityPct(candles);
  const pctHit =
    candleVelocityPct != null && candleVelocityPct <= VELOCITY_SHORT_CANDLE_PCT;
  const bearishBody =
    candleVelocityPct != null &&
    candleVelocityPct < 0 &&
    snap.close < snap.ema21;
  const isVelocity =
    pctHit ||
    bearishBody ||
    (snap.rsi14 < VELOCITY_RSI_MAX_SHORT &&
      rvol24h > VELOCITY_RVOL_MIN &&
      snap.bearishCross);
  return { isVelocity, rvol24h, candleVelocityPct };
}

export function formatVelocityTp70Summary(symbols: string[]): string {
  const uniq = [
    ...new Set(
      symbols
        .map((s) => s.toUpperCase().replace(/\//g, ""))
        .filter((s) => s.length > 0),
    ),
  ];
  if (uniq.length === 0) return "velocity-tp-70:unknown";
  return `velocity-tp-70:${uniq.join(",")}`;
}

export function pickVelocityBreakoutCandidate(params: {
  symbols: string[];
  snapshots: Map<string, Scalp1mSnapshot>;
  candlesBySymbol: Map<string, ScalpCandle[]>;
  held: Set<string>;
}): VelocityBreakoutCandidate | null {
  let best: VelocityBreakoutCandidate | null = null;

  for (const raw of params.symbols) {
    const symbol = norm(raw);
    if (params.held.has(symbol)) continue;

    const snap = params.snapshots.get(symbol);
    if (!snap) continue;

    const candles = params.candlesBySymbol.get(symbol) ?? [];
    const gate = evaluateVelocityBreakout(snap, candles);
    if (!gate.isVelocity) continue;

    const row: VelocityBreakoutCandidate = {
      symbol,
      snap,
      rvol24h: gate.rvol24h,
      candleVelocityPct: gate.candleVelocityPct ?? 0,
    };

    if (
      !best ||
      gate.rvol24h > best.rvol24h ||
      (gate.rvol24h === best.rvol24h && snap.rsi14 > best.snap.rsi14)
    ) {
      best = row;
    }
  }

  return best;
}

/** Bearish velocity candidate for RISK_OFF short regime. */
export function pickVelocityBreakdownCandidate(params: {
  symbols: string[];
  snapshots: Map<string, Scalp1mSnapshot>;
  candlesBySymbol: Map<string, ScalpCandle[]>;
  held: Set<string>;
}): VelocityBreakoutCandidate | null {
  let best: VelocityBreakoutCandidate | null = null;

  for (const raw of params.symbols) {
    const symbol = norm(raw);
    if (params.held.has(symbol)) continue;

    const snap = params.snapshots.get(symbol);
    if (!snap) continue;

    const candles = params.candlesBySymbol.get(symbol) ?? [];
    const gate = evaluateVelocityBreakdown(snap, candles);
    if (!gate.isVelocity) continue;

    const row: VelocityBreakoutCandidate = {
      symbol,
      snap,
      rvol24h: gate.rvol24h,
      candleVelocityPct: gate.candleVelocityPct ?? 0,
    };

    const absVel = Math.abs(gate.candleVelocityPct ?? 0);
    const bestVel = Math.abs(best?.candleVelocityPct ?? 0);
    if (
      !best ||
      absVel > bestVel ||
      (absVel === bestVel && gate.rvol24h > best.rvol24h)
    ) {
      best = row;
    }
  }

  return best;
}
