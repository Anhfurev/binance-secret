import type { Scalp1mSnapshot, ScalpCandle } from "@/lib/trading/paper-scalp-indicators";
import { normalizePaperSymbol } from "@/lib/trading/paper-scalp-mark-price";
import { computeRvol24h } from "@/lib/trading/paper-scalp-vwap";

export const VELOCITY_RSI_MIN = 60;
export const VELOCITY_RVOL_MIN = 2;
export const VELOCITY_TP_GAIN_PCT = 0.015;
export const VELOCITY_PARTIAL_SELL_RATIO = 0.7;

export type VelocityBreakoutCandidate = {
  symbol: string;
  snap: Scalp1mSnapshot;
  rvol24h: number;
};

function norm(sym: string): string {
  return normalizePaperSymbol(sym);
}

export function evaluateVelocityBreakout(
  snap: Scalp1mSnapshot,
  candles: ScalpCandle[],
): { isVelocity: boolean; rvol24h: number } {
  const rvol24h = computeRvol24h(candles);
  const isVelocity =
    snap.rsi14 > VELOCITY_RSI_MIN && rvol24h > VELOCITY_RVOL_MIN;
  return { isVelocity, rvol24h };
}

/** Best watchlist symbol matching explosive RVOL + RSI velocity gate. */
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
