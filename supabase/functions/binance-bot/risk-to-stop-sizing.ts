// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { MIN_TRADE_USD } from "./constants.ts";
import { formatBuyAmountWithinUsdCap } from "./exchange-client.ts";
import { TRADING_POLICY } from "./config/trading-policy.ts";
import { toNumber } from "./utils.ts";

export const DEFAULT_RISK_PER_TRADE_PERCENT = TRADING_POLICY.risk.riskPerTradePercentDefault;
export const DEFAULT_NOTIONAL_CAP_FRACTION = TRADING_POLICY.risk.notionalCapFractionDefault;

export function readRiskPerTradePercent(): number {
  const raw = String(Deno.env.get("RISK_PER_TRADE_PERCENT") ?? "").trim();
  const n = raw.length ? Number(raw) : DEFAULT_RISK_PER_TRADE_PERCENT;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RISK_PER_TRADE_PERCENT;
  return Math.min(5, Math.max(0.1, n));
}

export function readNotionalCapFraction(): number {
  const raw = String(Deno.env.get("NOTIONAL_CAP_FRACTION") ?? "").trim();
  const n = raw.length ? Number(raw) : DEFAULT_NOTIONAL_CAP_FRACTION;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_NOTIONAL_CAP_FRACTION;
  return Math.min(1, Math.max(0.05, n));
}

export async function loadProfileDemoBalance(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<number | null> {
  if (!userId || userId === "unknown") return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("demo_balance")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  const balance = toNumber(data?.demo_balance, NaN);
  return Number.isFinite(balance) && balance > 0 ? balance : null;
}

export function resolveRiskToStopNotionalUsd(params: {
  totalEquity: number;
  entryPrice: number;
  stopLossPrice: number;
}): {
  riskUsd: number;
  notionalUsd: number;
  cappedByNotional: boolean;
  riskPerTradePct: number;
  notionalCapFraction: number;
} {
  const totalEquity = Math.max(0, toNumber(params.totalEquity, 0));
  const entryPrice = toNumber(params.entryPrice, 0);
  const stopLossPrice = toNumber(params.stopLossPrice, 0);
  const riskPerTradePct = readRiskPerTradePercent();
  const notionalCapFraction = readNotionalCapFraction();
  const riskUsd = totalEquity * (riskPerTradePct / 100);
  const stopDistance = entryPrice - stopLossPrice;
  const notionalCapUsd = totalEquity * notionalCapFraction;
  let notionalUsd = 0;
  let cappedByNotional = false;

  if (totalEquity > 0 && entryPrice > 0 && stopDistance > 0 && riskUsd > 0) {
    notionalUsd = (riskUsd * entryPrice) / stopDistance;
    if (notionalCapUsd > 0 && notionalUsd > notionalCapUsd) {
      notionalUsd = notionalCapUsd;
      cappedByNotional = true;
    }
  }

  notionalUsd = Math.min(totalEquity, Math.max(0, notionalUsd));
  return {
    riskUsd: Number(riskUsd.toFixed(8)),
    notionalUsd: Number(notionalUsd.toFixed(8)),
    cappedByNotional,
    riskPerTradePct,
    notionalCapFraction,
  };
}

export async function calculateQuantityFromRiskToStop(params: {
  symbol: string;
  totalEquity: number;
  entryPrice: number;
  stopLossPrice: number;
}): Promise<{
  qty: number;
  riskUsd: number;
  notionalUsd: number;
  sizingMeta: Record<string, unknown>;
}> {
  const sizing = resolveRiskToStopNotionalUsd(params);
  let notionalUsd = sizing.notionalUsd;
  if (notionalUsd > 0 && notionalUsd < MIN_TRADE_USD) {
    notionalUsd = Math.min(params.totalEquity, MIN_TRADE_USD);
  }
  const qty = notionalUsd > 0
    ? await formatBuyAmountWithinUsdCap(params.symbol, notionalUsd, params.entryPrice)
    : 0;
  return {
    qty,
    riskUsd: sizing.riskUsd,
    notionalUsd,
    sizingMeta: {
      sizing_model: "risk_to_stop",
      risk_per_trade_pct: sizing.riskPerTradePct,
      notional_cap_fraction: sizing.notionalCapFraction,
      total_equity_usd: Number(params.totalEquity.toFixed(8)),
      risked_amount_usd: sizing.riskUsd,
      notional_size_usd: Number(notionalUsd.toFixed(8)),
      notional_capped: sizing.cappedByNotional,
      entry_price_sizing: Number(params.entryPrice.toFixed(8)),
      stop_loss_price_sizing: Number(params.stopLossPrice.toFixed(8)),
    },
  };
}
