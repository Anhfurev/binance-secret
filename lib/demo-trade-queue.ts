import type { AITradeSignal, DemoTrade } from "@/lib/types";
import { insertTrade, fetchTradeHistory } from "@/lib/supabase";

async function makeDemoTrade(
  signal: AITradeSignal,
  user_id: string,
  followedSignal: boolean,
  overrides?: Partial<DemoTrade>,
) {
  const amount =
    signal.currentPrice > 1000 ? 0.3 : signal.currentPrice > 50 ? 8 : 500;
  const value = Number((amount * signal.entryPrice).toFixed(2));

  const trade = {
    signalId: signal.id,
    coinId: signal.coinId,
    symbol: signal.symbol,
    type: signal.signalType.includes("SELL") ? "sell" : "buy",
    entryPrice: signal.entryPrice,
    amount,
    value,
    status: "open",
    opened_at: new Date().toISOString(),
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfits[0]?.price ?? signal.entryPrice * 1.05,
    followedSignal,
    user_id,
    ...overrides,
  };
  await insertTrade(trade);
  return trade;
}

export async function enqueueDemoTradeFromSignal(
  signal: AITradeSignal,
  user_id: string,
  followedSignal = true,
  overrides?: Partial<DemoTrade>,
) {
  await makeDemoTrade(signal, user_id, followedSignal, overrides);
}

export async function consumeQueuedDemoTrades(
  user_id: string,
): Promise<DemoTrade[]> {
  const trades = await fetchTradeHistory(user_id);
  // Optionally filter for status 'open' or 'queued'
  return trades.filter(
    (trade) => trade.status === "open" || trade.status === "queued",
  );
}
