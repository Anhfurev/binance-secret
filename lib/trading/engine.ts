import { AITradeSignal, DemoAccount, DemoTrade } from "@/lib/types";

export const calculatePnL = (trade: DemoTrade, currentPrice: number) => {
  const isLong = trade.direction === "LONG" || trade.type === "buy";
  const diff = isLong
    ? currentPrice - trade.entryPrice
    : trade.entryPrice - currentPrice;
  const pnl = diff * trade.amount;
  return Number(pnl.toFixed(2));
};

export const checkStrategyMatch = (signal: AITradeSignal, strategy: any) => {
  if (!strategy) return true;
  const { rsi } = signal.technicalIndicators;
  if (strategy.config.useRsi) {
    if (signal.signalType.includes("BUY") && rsi > strategy.config.rsiOversold)
      return false;
    if (
      signal.signalType.includes("SELL") &&
      rsi < strategy.config.rsiOverbought
    )
      return false;
  }
  return signal.confidence >= strategy.config.minSignalConfidence;
};
