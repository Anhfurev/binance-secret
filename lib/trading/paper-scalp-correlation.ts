import type { Scalp1mSnapshot } from "@/lib/trading/paper-scalp-indicators";
import { normalizePaperSymbol } from "@/lib/trading/paper-scalp-mark-price";

/** Max concurrent long legs per workspace (correlated alt exposure cap). */
export const MAX_OPEN_LEGS_PER_WORKSPACE = 2;

const BTC_SYMBOL = "BTCUSDT";

export function isAltcoinSymbol(symbol: string): boolean {
  return normalizePaperSymbol(symbol) !== BTC_SYMBOL;
}

export function isBtcBearish1h(
  snapshots: Map<string, Scalp1mSnapshot>,
): boolean {
  const btc = snapshots.get(BTC_SYMBOL);
  if (!btc) return false;
  return btc.ema9 < btc.ema21;
}

export function logCorrelationFilterSkip(_symbol: string): void {
  /* silent — high-signal events surface via manifest */
}

export function logBtcRegimePause(_symbol: string): void {
  /* silent — regime shown on tactical pulse / high-signal manifest */
}

export function passesCorrelationExposureGate(openLegCount: number): boolean {
  return openLegCount < MAX_OPEN_LEGS_PER_WORKSPACE;
}

/**
 * ENTRY-ONLY gate — never call from exit/stop/TP paths.
 * Open legs are managed in evaluateOpenPaperPosition before this runs.
 */
export function passesBtcAltcoinGate(
  symbol: string,
  snapshots: Map<string, Scalp1mSnapshot>,
): boolean {
  if (!isAltcoinSymbol(symbol)) return true;
  if (!isBtcBearish1h(snapshots)) return true;
  return false;
}
