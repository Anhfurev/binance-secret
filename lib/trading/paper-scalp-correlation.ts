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

export function logCorrelationFilterSkip(symbol: string): void {
  console.log(
    `[CORRELATION-FILTER] Max risk exposure reached. Skipping entry for ${normalizePaperSymbol(symbol)}`,
  );
}

export function logBtcRegimePause(symbol: string): void {
  console.log(
    `[BTC-REGIME] Bearish 1h (EMA9 < EMA21) — pausing altcoin entry for ${normalizePaperSymbol(symbol)}`,
  );
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
