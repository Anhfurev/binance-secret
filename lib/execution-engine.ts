import type { AITradeSignal } from "@/lib/types";
import {
  getServerSideBinanceClient,
  type BinanceSpotOrderResponse,
} from "@/lib/binance";
import {
  clampRiskPercent,
  computeAverageFillPrice,
  ensureBtcSignal,
  floorQuantity,
  getActionableSide,
  getBalance,
  getLotSizeFilter,
  getMinNotionalFilter,
  loadRiskPercent,
  logExecutedTrade,
  toNumber,
  type ExecutionSide,
} from "@/lib/services/execution/execution-helpers";

const TRADE_SYMBOL = "BTCUSDT";
const BASE_ASSET = "BTC";
const QUOTE_ASSET = "USDT";

type SignalsRouteResponse = {
  signals?: AITradeSignal[];
};


export interface ExecutedTradeLog {
  orderId: number;
  fillPrice: number;
  executedQty: number;
  notionalUsd: number;
}

export interface ExecuteLiveSignalParams {
  userId: string;
  signal: AITradeSignal;
}

export interface ExecuteLiveSignalFromRouteParams {
  origin: string;
  userId: string;
  signalId?: string;
}

export interface LiveExecutionResult {
  symbol: string;
  side: ExecutionSide;
  riskPercent: number;
  balanceAsset: string;
  availableBalance: number;
  orderId: number;
  fillPrice: number;
  executedQty: number;
  notionalUsd: number;
  tradeLog: ExecutedTradeLog;
}


export async function loadBtcSignalFromAiRoute(
  origin: string,
  signalId?: string,
): Promise<AITradeSignal> {
  const response = await fetch(`${origin}/api/signals`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Signals route failed with ${response.status}`);
  }

  const data = (await response.json()) as SignalsRouteResponse;
  const signals = data.signals ?? [];

  const btcSignals = signals.filter((signal) => {
    const symbol = signal.symbol.toUpperCase();
    return symbol === BASE_ASSET || symbol === TRADE_SYMBOL;
  });

  if (btcSignals.length === 0) {
    throw new Error(`No ${TRADE_SYMBOL} signal returned by /api/signals`);
  }

  if (signalId) {
    const selected = btcSignals.find((signal) => signal.id === signalId);
    if (!selected) {
      throw new Error(`Signal ${signalId} was not found in /api/signals output`);
    }
    return selected;
  }

  const actionable = btcSignals
    .filter((signal) => signal.signalType !== "HOLD")
    .sort((left, right) => right.confidence - left.confidence);

  if (actionable.length === 0) {
    throw new Error(`No actionable ${TRADE_SYMBOL} signal is currently available`);
  }

  return actionable[0];
}

export async function executeLiveSignal(
  params: ExecuteLiveSignalParams,
): Promise<LiveExecutionResult> {
  const { userId, signal } = params;
  ensureBtcSignal(signal, TRADE_SYMBOL, BASE_ASSET);

  const side = getActionableSide(signal);
  const riskPercent = await loadRiskPercent(userId);
  const client = getServerSideBinanceClient();

  const [account, currentPrice, symbolInfo] = await Promise.all([
    client.getAccountInfo(),
    client.getSymbolPrice(TRADE_SYMBOL),
    client.getExchangeSymbolInfo(TRADE_SYMBOL),
  ]);

  if (!symbolInfo) {
    throw new Error(`Binance exchange info not found for ${TRADE_SYMBOL}`);
  }

  if (!account.canTrade) {
    throw new Error("Binance account trading permission is disabled");
  }

  const usdtBalance = getBalance(account, QUOTE_ASSET);
  const btcBalance = getBalance(account, BASE_ASSET);
  const btcValueUsd = btcBalance.free * currentPrice;
  const totalEquityUsd = usdtBalance.free + btcValueUsd;
  const riskCapitalUsd = Number(
    ((totalEquityUsd * riskPercent) / 100).toFixed(2),
  );

  if (riskCapitalUsd <= 0) {
    throw new Error("Risk capital is zero. Check balances and bot_settings risk %.");
  }

  const referenceEntry = signal.entryPrice > 0 ? signal.entryPrice : currentPrice;
  const stopDistanceUsd = Math.abs(referenceEntry - signal.stopLoss);
  if (stopDistanceUsd <= 0) {
    throw new Error("Signal stop-loss is required for risk-based live execution");
  }

  const quantityByRisk = riskCapitalUsd / stopDistanceUsd;
  const lotSizeFilter = getLotSizeFilter(symbolInfo);
  const minNotionalFilter = getMinNotionalFilter(symbolInfo);
  const minQty = toNumber(lotSizeFilter?.minQty);
  const minNotional = toNumber(minNotionalFilter?.minNotional);
  const stepSize = lotSizeFilter?.stepSize;

  let order: BinanceSpotOrderResponse;
  let availableBalance: number;
  let executedQty: number;
  let notionalUsd: number;

  if (side === "BUY") {
    availableBalance = usdtBalance.free;
    const notionalByRisk = quantityByRisk * currentPrice;
    const quoteOrderQty = Number(
      Math.min(notionalByRisk, availableBalance).toFixed(2),
    );

    if (quoteOrderQty <= 0) {
      throw new Error("Insufficient USDT balance for BUY execution");
    }

    if (minNotional > 0 && quoteOrderQty < minNotional) {
      throw new Error(
        `BUY notional ${quoteOrderQty} is below Binance minimum notional ${minNotional}`,
      );
    }

    order = await client.marketBuy({
      symbol: TRADE_SYMBOL,
      quoteOrderQty,
    });

    executedQty = toNumber(order.executedQty);
    notionalUsd = toNumber(order.cummulativeQuoteQty);
  } else {
    availableBalance = btcBalance.free;
    const rawQuantity = Math.min(quantityByRisk, availableBalance);
    const quantity = floorQuantity(rawQuantity, stepSize);

    if (quantity <= 0) {
      throw new Error("Insufficient BTC balance for SELL execution");
    }

    if (minQty > 0 && quantity < minQty) {
      throw new Error(
        `SELL quantity ${quantity} is below Binance minimum quantity ${minQty}`,
      );
    }

    const estimatedNotional = quantity * currentPrice;
    if (minNotional > 0 && estimatedNotional < minNotional) {
      throw new Error(
        `SELL notional ${estimatedNotional.toFixed(2)} is below Binance minimum notional ${minNotional}`,
      );
    }

    order = await client.marketSell({
      symbol: TRADE_SYMBOL,
      quantity,
      stepSize,
    });

    executedQty = toNumber(order.executedQty);
    notionalUsd = toNumber(order.cummulativeQuoteQty);
  }

  if (executedQty <= 0) {
    throw new Error(`Binance returned zero executed quantity for order ${order.orderId}`);
  }

  const fillPrice = computeAverageFillPrice(order, currentPrice);

  await logExecutedTrade({
    userId,
    signal,
    side,
    riskPercent,
    order,
    fillPrice,
    executedQty,
    notionalUsd,
    tradeSymbol: TRADE_SYMBOL,
  });

  return {
    symbol: TRADE_SYMBOL,
    side,
    riskPercent,
    balanceAsset: side === "BUY" ? QUOTE_ASSET : BASE_ASSET,
    availableBalance,
    orderId: order.orderId,
    fillPrice,
    executedQty,
    notionalUsd,
    tradeLog: {
      orderId: order.orderId,
      fillPrice,
      executedQty,
      notionalUsd,
    },
  };
}

export async function executeLiveSignalFromAiRoute(
  params: ExecuteLiveSignalFromRouteParams,
) {
  const signal = await loadBtcSignalFromAiRoute(params.origin, params.signalId);
  return executeLiveSignal({
    userId: params.userId,
    signal,
  });
}