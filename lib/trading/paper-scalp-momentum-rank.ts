import type { Scalp1mSnapshot, ScalpCandle } from "@/lib/trading/paper-scalp-indicators";
import { normalizePaperSymbol } from "@/lib/trading/paper-scalp-mark-price";
import { computeRvol24h } from "@/lib/trading/paper-scalp-vwap";
import type { DynamicMarketRegime } from "@/lib/trading/paper-scalp-regime";

const BTC_SYMBOL = "BTCUSDT";

export type AltcoinMomentumRow = {
  symbol: string;
  score: number;
  rsi14: number;
  rvol24h: number;
  emaMomentum: number;
  snap: Scalp1mSnapshot;
};

function norm(sym: string): string {
  return normalizePaperSymbol(sym);
}

function isAltcoin(symbol: string): boolean {
  return norm(symbol) !== BTC_SYMBOL;
}

function scoreAltcoin(
  snap: Scalp1mSnapshot,
  rvol: number,
  regime: DynamicMarketRegime,
): number {
  const emaSpread =
    snap.ema21 > 0 ? (snap.ema9 - snap.ema21) / snap.ema21 : 0;
  let score = rvol * 40;
  score += Math.max(0, emaSpread) * 120;
  score += snap.rsi14 <= 55 ? (55 - snap.rsi14) * 0.35 : 0;
  if (snap.bullishCross) score += 12;
  if (regime.state === "bullish") score += 8;
  return Number(score.toFixed(4));
}

function scoreAltcoinShort(
  snap: Scalp1mSnapshot,
  rvol: number,
): number {
  const emaSpread =
    snap.ema21 > 0 ? (snap.ema9 - snap.ema21) / snap.ema21 : 0;
  let score = rvol * 40;
  score += Math.max(0, -emaSpread) * 120;
  score += snap.rsi14 >= 45 ? (snap.rsi14 - 45) * 0.35 : 0;
  if (snap.bearishCross) score += 12;
  if (snap.close < snap.ema21) score += 8;
  return Number(score.toFixed(4));
}

/**
 * Rank watchlist by 24h RVOL + RSI + EMA momentum for capital rotation.
 */
export function rankAltcoinMomentum(params: {
  symbols: string[];
  snapshots: Map<string, Scalp1mSnapshot>;
  candlesBySymbol: Map<string, ScalpCandle[]>;
  regime: DynamicMarketRegime;
  held?: Set<string>;
}): AltcoinMomentumRow[] {
  const held = params.held ?? new Set<string>();
  const rows: AltcoinMomentumRow[] = [];

  for (const raw of params.symbols) {
    const symbol = norm(raw);
    if (!isAltcoin(symbol) || held.has(symbol)) continue;

    const snap = params.snapshots.get(symbol);
    if (!snap) continue;

    const candles = params.candlesBySymbol.get(symbol) ?? [];
    const rvol24h = computeRvol24h(candles);
    const score =
      params.regime.entryMode === "short"
        ? scoreAltcoinShort(snap, rvol24h)
        : scoreAltcoin(snap, rvol24h, params.regime);

    rows.push({
      symbol,
      score,
      rsi14: snap.rsi14,
      rvol24h,
      emaMomentum: Number(
        (snap.ema21 > 0 ? (snap.ema9 - snap.ema21) / snap.ema21 : 0).toFixed(4),
      ),
      snap,
    });
  }

  return rows.sort((a, b) => b.score - a.score);
}

export function buildDeployLeaderboard(
  ranked: AltcoinMomentumRow[],
  deployTopN: number,
): AltcoinMomentumRow[] {
  if (deployTopN <= 0) return [];
  return ranked.slice(0, deployTopN);
}
