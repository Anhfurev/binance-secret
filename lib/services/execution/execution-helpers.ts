import type { AITradeSignal } from "@/lib/types";
import {
  floorToStep,
  type BinanceExchangeSymbol,
  type BinanceSpotAccountInfo,
  type BinanceSpotOrderResponse,
} from "@/lib/binance";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

const DEFAULT_RISK_PERCENT = Number(process.env.DEFAULT_BOT_RISK_PERCENT ?? 1);

type BotSettingsRow = Record<string, unknown> & {
  risk_percent?: number;
  riskPercent?: number;
  updated_at?: string;
};

export type ExecutionSide = "BUY" | "SELL";

export function clampRiskPercent(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_RISK_PERCENT;
  return Math.min(100, Math.max(0.1, value));
}

export function toNumber(value: string | number | undefined | null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function getActionableSide(signal: AITradeSignal): ExecutionSide {
  if (signal.signalType.includes("BUY")) return "BUY";
  if (signal.signalType.includes("SELL")) return "SELL";
  throw new Error(`Signal ${signal.id} is not actionable: ${signal.signalType}`);
}

export function ensureBtcSignal(signal: AITradeSignal, tradeSymbol: string, baseAsset: string) {
  const normalized = signal.symbol.toUpperCase();
  if (normalized !== baseAsset && normalized !== tradeSymbol) {
    throw new Error(`Execution engine only supports ${tradeSymbol}. Received ${signal.symbol}.`);
  }
}

export function getBalance(account: BinanceSpotAccountInfo, asset: string) {
  const balance = account.balances.find((entry) => entry.asset.toUpperCase() === asset.toUpperCase());
  return { free: toNumber(balance?.free), locked: toNumber(balance?.locked) };
}

export function getLotSizeFilter(symbolInfo: BinanceExchangeSymbol) {
  return symbolInfo.filters.find((filter) => filter.filterType === "LOT_SIZE");
}

export function getMinNotionalFilter(symbolInfo: BinanceExchangeSymbol) {
  return symbolInfo.filters.find((filter) => filter.filterType === "MIN_NOTIONAL" || filter.filterType === "NOTIONAL");
}

export function computeAverageFillPrice(order: BinanceSpotOrderResponse, fallbackPrice: number) {
  const fills = order.fills ?? [];
  if (fills.length > 0) {
    const totalQty = fills.reduce((sum, fill) => sum + toNumber(fill.qty), 0);
    const totalValue = fills.reduce((sum, fill) => sum + toNumber(fill.qty) * toNumber(fill.price), 0);
    if (totalQty > 0) return Number((totalValue / totalQty).toFixed(2));
  }
  const executedQty = toNumber(order.executedQty);
  const quoteQty = toNumber(order.cummulativeQuoteQty);
  if (executedQty > 0 && quoteQty > 0) return Number((quoteQty / executedQty).toFixed(2));
  return Number(fallbackPrice.toFixed(2));
}

export async function loadRiskPercent(userId: string) {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) return clampRiskPercent(DEFAULT_RISK_PERCENT);
  const { data, error } = await supabaseAdmin
    .from("bot_settings")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<BotSettingsRow>();

  if (error) {
    if (
      error.message.includes("bot_settings") &&
      (error.message.includes("does not exist") || error.message.includes("schema cache") || error.message.includes("relation"))
    ) {
      return clampRiskPercent(DEFAULT_RISK_PERCENT);
    }
    throw error;
  }

  const row = data ?? {};
  const nestedRisk = row.risk && typeof row.risk === "object" ? (row.risk as Record<string, unknown>) : null;
  const riskPercent =
    typeof row.risk_percent === "number"
      ? row.risk_percent
      : typeof row.riskPercent === "number"
        ? row.riskPercent
        : typeof nestedRisk?.risk_percent === "number"
          ? (nestedRisk.risk_percent as number)
          : typeof nestedRisk?.riskPercent === "number"
            ? (nestedRisk.riskPercent as number)
            : DEFAULT_RISK_PERCENT;

  return clampRiskPercent(riskPercent);
}

export async function logExecutedTrade(params: {
  userId: string;
  signal: AITradeSignal;
  side: ExecutionSide;
  riskPercent: number;
  order: BinanceSpotOrderResponse;
  fillPrice: number;
  executedQty: number;
  notionalUsd: number;
  tradeSymbol: string;
}) {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    throw new Error("Supabase admin client is not configured");
  }

  const { userId, signal, side, riskPercent, order, fillPrice, executedQty, notionalUsd, tradeSymbol } = params;
  const baseTrade = {
    user_id: userId,
    signalId: signal.id,
    coinId: signal.coinId,
    symbol: tradeSymbol,
    type: side === "BUY" ? "buy" : "sell",
    entryPrice: fillPrice,
    amount: executedQty,
    value: Number(notionalUsd.toFixed(2)),
    status: "open",
    opened_at: new Date(order.transactTime).toISOString(),
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfits[0]?.price ?? signal.entryPrice,
    followedSignal: true,
  };

  const richInsert = await supabaseAdmin.from("trades").insert([
    {
      ...baseTrade,
      notes: `Real Binance execution ${order.orderId} at ${fillPrice} on ${tradeSymbol}`,
      executionNotes: [
        `Order ID: ${order.orderId}`,
        `Fill Price: ${fillPrice}`,
        `Risk %: ${riskPercent}`,
        `Binance Status: ${order.status}`,
      ],
      binance_order_id: String(order.orderId),
      fill_price: fillPrice,
      risk_percent: riskPercent,
      exchange: "binance",
    },
  ]);
  if (!richInsert.error) return;

  const fallbackInsert = await supabaseAdmin.from("trades").insert([
    {
      ...baseTrade,
      notes:
        `Real Binance execution | Order ID ${order.orderId} | Fill ${fillPrice} | ` +
        `Risk ${riskPercent}% | Status ${order.status}`,
    },
  ]);
  if (fallbackInsert.error) throw fallbackInsert.error;
}

export function floorQuantity(rawQuantity: number, stepSize?: string) {
  return stepSize ? floorToStep(rawQuantity, stepSize) : rawQuantity;
}
