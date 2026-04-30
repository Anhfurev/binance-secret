// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { AsyncLocalStorage } from "node:async_hooks";
import type { BotSettingsRow, OpenTradeRow } from "./types.ts";
import { ATR_STOP_TRAIL_MULTIPLIER } from "./constants.ts";
import { clamp, toNumber } from "./utils.ts";

export const DEFAULT_STRATEGY_NOTES = "unknown_strategy|no_reason";
export const DEFAULT_TRAILING_STOP_PCT = 0.015;
export const HEARTBEAT_DEBOUNCE_MS = 60_000;
export const DEFAULT_MAX_DRAWDOWN_LIMIT_PCT = 5;
const USD_CENT_SCALE = 100;
const lastHeartbeatAtByKey = new Map<string, number>();

/**
 * Derive whether a given bot row should run in TEST (paper) or LIVE mode.
 * Live trading requires an explicit `is_live_trading_enabled=true` flag on the
 * bot_settings row. Anything else (null, false, missing) → test mode.
 */
export function resolveTestMode(row: BotSettingsRow | undefined | null): boolean {
  return !Boolean((row as any)?.is_live_trading_enabled);
}

/**
 * Ghost / shadow mode: DB + logs behave like a real run, but orders never leave
 * the Edge function (createOrder short-circuits). Use a dedicated bot_settings
 * row per strategy to compare PnL vs live after N closed ghost cycles.
 */
export function resolveGhostMode(row: BotSettingsRow | undefined | null): boolean {
  return Boolean((row as any)?.is_ghost_execution);
}

/** True when CCXT / Binance signed orders must not run. */
export function resolveExchangeSkipped(row: BotSettingsRow | undefined | null): boolean {
  return resolveTestMode(row) || resolveGhostMode(row);
}

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Request-scoped cycle id to avoid cross-request contamination in warm isolates. */
const telegramCycleStorage = new AsyncLocalStorage<{ cycleId: string | null }>();

export async function withTelegramCycleScope<T>(
  cycleId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const next = cycleId && String(cycleId).trim().length > 0 ? String(cycleId).trim() : null;
  return await telegramCycleStorage.run({ cycleId: next }, fn);
}

export function setActiveTelegramCycleId(id: string | null) {
  const store = telegramCycleStorage.getStore();
  if (!store) return;
  store.cycleId = id && String(id).trim().length > 0 ? String(id).trim() : null;
}

export function getActiveTelegramCycleId(): string | null {
  return telegramCycleStorage.getStore()?.cycleId ?? null;
}

/** Appends a standard footer for log correlation (override wins over active context). */
export function formatTelegramCycleFooter(overrideCycleId?: string | null): string {
  const activeCycleId = getActiveTelegramCycleId();
  const id = String(overrideCycleId ?? activeCycleId ?? "").trim();
  if (!id) return "";
  return `\n\n<b>cycle_id:</b> <code>${escapeHtml(id)}</code>`;
}

export function formatTelegramPrice(price: number) {
  return price < 0.01 ? price.toFixed(8) : price.toFixed(2);
}

export function formatUsdAlertAmount(value: number) {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function resolveCombinedStrategyNotes(raw?: string) {
  const s = String(raw ?? "").trim();
  if (!s) return DEFAULT_STRATEGY_NOTES;
  const pipe = s.indexOf("|");
  if (pipe < 0) return DEFAULT_STRATEGY_NOTES;
  const left = s.slice(0, pipe).trim();
  const right = s.slice(pipe + 1).trim();
  if (!left || !right) return DEFAULT_STRATEGY_NOTES;
  return `${left}|${right}`;
}

export function shouldSendHeartbeat(key: string) {
  const now = Date.now();
  const lastSent = lastHeartbeatAtByKey.get(key) ?? 0;
  if (now - lastSent < HEARTBEAT_DEBOUNCE_MS) return false;
  lastHeartbeatAtByKey.set(key, now);
  return true;
}

export function toUsdCents(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * USD_CENT_SCALE);
}

export function fromUsdCents(cents: number) {
  return Number((cents / USD_CENT_SCALE).toFixed(2));
}

export async function getLatestRecordedBalance(
  supabase: ReturnType<typeof createClient>,
  userId: string,
) {
  const latest = await supabase
    .from("account_balances")
    .select("balance, timestamp")
    .eq("user_id", userId)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) {
    console.warn(
      `[binance-bot] latest account_balances lookup skipped: ${latest.error.message}`,
    );
    return null;
  }
  const balance = toNumber((latest.data as any)?.balance, 0);
  return Number.isFinite(balance) && balance > 0 ? balance : null;
}

export function resolveTrailingStopPct(value: unknown) {
  const raw = toNumber(value, DEFAULT_TRAILING_STOP_PCT);
  const normalized = raw > 1 ? raw / 100 : raw;
  return clamp(normalized, 0.001, 0.2);
}

export function buildTrailingStopState(
  openTrade: OpenTradeRow,
  currentPrice: number,
  trailingStopPct: number,
  /** When > 0, trail distance below high = `ATR_STOP_TRAIL_MULTIPLIER × atr14` (volatility-adjusted). */
  atr14?: number,
) {
  const extra = (openTrade.extra as Record<string, unknown> | undefined) ?? {};
  const entryPrice = toNumber(openTrade.entryPrice, currentPrice);
  const storedHigh = toNumber(
    extra.highest_price_seen ?? extra.highest_price_reached,
    entryPrice,
  );
  const highestPrice = Math.max(storedHigh, currentPrice);
  const useAtr =
    Number.isFinite(atr14) &&
    atr14 != null &&
    Number(atr14) > 0;
  const storedAtrMult = toNumber(extra.vol_burst_effective_atr_mult, 0);
  const atrTrailMult =
    useAtr && storedAtrMult > 0.5 && storedAtrMult < 4
      ? storedAtrMult
      : ATR_STOP_TRAIL_MULTIPLIER;
  const rawTrailingStop = useAtr
    ? highestPrice - atrTrailMult * Number(atr14)
    : highestPrice * (1 - trailingStopPct);
  const currentPnlPct = entryPrice > 0
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : 0;
  const breakEvenFloor = entryPrice * 1.001;
  const breakEvenGuardActive = currentPnlPct >= 1;
  const stopPrice = breakEvenGuardActive
    ? Math.max(rawTrailingStop, breakEvenFloor)
    : rawTrailingStop;
  const storedStopPrice = toNumber(extra.trailing_stop_price, 0);
  const shouldExit = currentPrice <= stopPrice && currentPrice < highestPrice;
  const shouldPersistStop = Math.abs(stopPrice - storedStopPrice) > 0.0000001;
  return {
    highestPrice: Number(highestPrice.toFixed(6)),
    stopPrice: Number(stopPrice.toFixed(6)),
    shouldExit,
    breakEvenGuardActive,
    shouldPersistHigh: highestPrice > storedHigh || shouldPersistStop,
  };
}

export function buildExecutionRow(
  row: BotSettingsRow,
  dynamicRiskPercentOverride: number | null,
) {
  if (!dynamicRiskPercentOverride) return row;
  return { ...row, risk_percent: dynamicRiskPercentOverride };
}
