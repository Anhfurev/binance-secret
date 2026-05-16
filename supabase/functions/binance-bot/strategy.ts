// @ts-nocheck
/**
 * Signal logic uses `IndicatorSnapshot.latestPrice` (1m close / ticker path) for
 * both paper and live — no alternate “paper price”. Execution realism (bid/ask,
 * fees, slippage) lives in `paper-fill.ts`, `binance.ts`, and `exchange-client.ts`
 * (`executeSmartLimitChaser` uses the live order book).
 */
import type {
  ExitReason,
  IndicatorSnapshot,
  OpenTradeRow,
} from "./types.ts";
import { canFireDbStopLoss } from "./strategy-stop-hold.ts";
import { gtWithTolerance } from "./strategy-numeric-tolerance.ts";
import { clamp, toNumber } from "./utils.ts";

export const STRATEGY_STOPLOSS = -0.25;

export type ExitCheckResult = {
  shouldExit: boolean;
  exit_reason: ExitReason;
};

export { checkEntryConditions } from "./strategy-entry-conditions.ts";
export type { EntryCheckResult } from "./types.ts";

function readTradeTakeProfitPrice(row: OpenTradeRow): number {
  const raw = row.takeProfit ?? (row as Record<string, unknown>)["takeProfit"];
  return toNumber(raw, NaN);
}

function hasDbTakeProfitPrice(openTrade: OpenTradeRow): boolean {
  const tp = readTradeTakeProfitPrice(openTrade);
  return Number.isFinite(tp) && tp > 0;
}

function readTradeStopLossPrice(row: OpenTradeRow): number {
  const raw = row.stopLoss ?? (row as Record<string, unknown>)["stopLoss"];
  return toNumber(raw, NaN);
}

/** Row has a usable absolute stop price from the DB (any positive finite value). */
function hasDbStopLossPrice(openTrade: OpenTradeRow): boolean {
  const sl = readTradeStopLossPrice(openTrade);
  return Number.isFinite(sl) && sl > 0;
}

/**
 * Long: exit when price trades at or through `stopLoss` (latestPrice <= SL).
 * Short: exit when latestPrice >= SL.
 * Uses DB `stopLoss` whenever present; no drawdown fallback when this column is set.
 */
function resolveStopExitReason(openTrade: OpenTradeRow, entryPrice: number): ExitReason {
  const extra = (openTrade.extra as Record<string, unknown> | undefined) ?? {};
  if (extra.partial_tp_executed !== true || extra.break_even_after_partial_tp !== true) {
    return "stoploss_hit";
  }
  const sl = readTradeStopLossPrice(openTrade);
  if (Number.isFinite(sl) && sl >= entryPrice * 0.999) return "be_stop_hit";
  return "stoploss_hit";
}

function hitAbsoluteStopLoss(openTrade: OpenTradeRow, latestPrice: number): boolean {
  if (!hasDbStopLossPrice(openTrade)) return false;
  const sl = readTradeStopLossPrice(openTrade);
  if (!Number.isFinite(latestPrice) || latestPrice <= 0) return false;
  const tradeType = String(openTrade.type ?? "buy").toLowerCase();
  const isShort = tradeType === "sell" || tradeType === "short";
  if (isShort) return latestPrice >= sl;
  return latestPrice <= sl;
}

/** Minimal ROI as a fraction (e.g. 0.04 for 4%) from DB % columns. */
function resolveMinimalRoiFromPctSources(
  openTrade: OpenTradeRow,
  settingsTakeProfitPct?: number,
): number {
  const tradePct = toNumber(openTrade.take_profit_pct, NaN);
  if (Number.isFinite(tradePct)) {
    return clamp(tradePct, 0.1, 100) / 100;
  }
  const settingsPct = toNumber(settingsTakeProfitPct, NaN);
  if (Number.isFinite(settingsPct)) {
    return clamp(settingsPct, 0.1, 100) / 100;
  }
  return NaN;
}

function hitAbsoluteTakeProfit(
  openTrade: OpenTradeRow,
  entryPrice: number,
  latestPrice: number,
): boolean {
  const tp = readTradeTakeProfitPrice(openTrade);
  if (!Number.isFinite(tp) || tp <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    return false;
  }
  const tradeType = String(openTrade.type ?? "buy").toLowerCase();
  const isShort = tradeType === "sell" || tradeType === "short";
  if (isShort) {
    return tp < entryPrice && latestPrice <= tp;
  }
  return tp > entryPrice && latestPrice >= tp;
}

export function checkExitConditions(
  openTrade: OpenTradeRow | null,
  snapshot: IndicatorSnapshot,
  settingsTakeProfitPct?: number,
): ExitCheckResult {
  if (!openTrade) {
    return { shouldExit: false, exit_reason: "no_open_trade" };
  }

  const entryPrice = Number(openTrade.entryPrice ?? 0);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return { shouldExit: false, exit_reason: "invalid_entry" };
  }

  const latestPrice = snapshot.latestPrice;
  const roi = (latestPrice - entryPrice) / entryPrice;

  // Absolute DB stop first (capital) — hardcoded -25% ROI only when no row stopLoss.
  if (hitAbsoluteStopLoss(openTrade, latestPrice)) {
    if (canFireDbStopLoss(openTrade)) {
      return { shouldExit: true, exit_reason: resolveStopExitReason(openTrade, entryPrice) };
    }
    return { shouldExit: false, exit_reason: "hold" };
  }

  if (hitAbsoluteTakeProfit(openTrade, entryPrice, latestPrice)) {
    return { shouldExit: true, exit_reason: "roi_target_hit" };
  }

  // If row has an absolute TP, do not allow fallback % ROI to front-run it.
  // This keeps RR/ATR-derived TP behavior deterministic for the open trade.
  if (!hasDbTakeProfitPrice(openTrade)) {
    const minimalRoi = resolveMinimalRoiFromPctSources(openTrade, settingsTakeProfitPct);
    if (Number.isFinite(minimalRoi) && minimalRoi > 0 && roi >= minimalRoi) {
      return { shouldExit: true, exit_reason: "roi_target_hit" };
    }
  }

  const useHardcodedDrawdownFallback = !hasDbStopLossPrice(openTrade);
  if (useHardcodedDrawdownFallback && roi <= STRATEGY_STOPLOSS) {
    if (canFireDbStopLoss(openTrade)) {
      return { shouldExit: true, exit_reason: "stoploss_hit" };
    }
    return { shouldExit: false, exit_reason: "hold" };
  }

  if (snapshot.rsi > 70) {
    if (canFireDbStopLoss(openTrade)) {
      return { shouldExit: true, exit_reason: "rsi_overbought" };
    }
    return { shouldExit: false, exit_reason: "hold" };
  }

  return { shouldExit: false, exit_reason: "hold" };
}

export function calculateTechnicalScore(snapshot: IndicatorSnapshot): number {
  let score = 0;

  if (gtWithTolerance(snapshot.latestPrice, snapshot.ema200)) score += 3;
  if (gtWithTolerance(snapshot.emaFast, snapshot.emaSlow)) score += 2;
  if (snapshot.macd.macd > snapshot.macd.signal) score += 2;

  if (snapshot.rsi >= 45 && snapshot.rsi <= 68) score += 2;
  else if (snapshot.rsi >= 32 && snapshot.rsi <= 75) score += 1;

  if (snapshot.rsi15m >= 45 && snapshot.rsi15m <= 65) score += 1;
  if (detectLiquiditySweep(snapshot)) score += 3;

  return Math.max(0, Math.min(10, score));
}

function detectLiquiditySweep(snapshot: IndicatorSnapshot): boolean {
  const recent = snapshot.candles5.slice(-3);
  if (recent.length === 0) return false;
  const dayLow = snapshot.dayLow24h;
  const avgVolume = snapshot.avgVolume1m;
  if (!Number.isFinite(dayLow) || dayLow <= 0) return false;
  if (!Number.isFinite(avgVolume) || avgVolume <= 0) return false;

  return recent.some((candle) => {
    const sweptLow = candle.low < dayLow;
    const reclaimed = candle.close > dayLow;
    const body = Math.abs(candle.close - candle.open);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const hasLongWick = lowerWick > 0 && lowerWick >= Math.max(body * 1.5, 0.0000001);
    const highVolume = candle.volume >= avgVolume * 2;
    return sweptLow && reclaimed && hasLongWick && highVolume;
  });
}

export {
  calculateAdx,
  getMarketRegime,
  getRegimeDiagnostics,
} from "./strategy-regime.ts";
