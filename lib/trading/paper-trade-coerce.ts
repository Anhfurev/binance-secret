import type { DemoTrade } from "@/lib/types";

function finite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

type LooseTrade = DemoTrade & Record<string, unknown>;

/** Normalize legacy/snake_case serialized legs before NAV + DB sync. */
export function coerceDemoTradeFields(trade: DemoTrade): DemoTrade | null {
  const raw = trade as LooseTrade;
  let entryPrice = finite(
    trade.entryPrice ?? raw.entry_price ?? raw.entryPrice,
    0,
  );
  let amount = finite(trade.amount ?? raw.qty ?? raw.quantity, 0);
  const value = finite(trade.value ?? raw.value_usdt, 0);

  if (entryPrice <= 0 && value > 0 && amount > 0) {
    entryPrice = value / amount;
  }
  if (amount <= 0 && value > 0 && entryPrice > 0) {
    amount = value / entryPrice;
  }

  if (entryPrice <= 0 || amount <= 0 || !String(trade.symbol ?? "").trim()) {
    return null;
  }

  const symbol = String(trade.symbol).toUpperCase().replace(/\//g, "");
  const stopLoss = finite(
    trade.stopLoss ?? raw.stop_loss ?? raw.stopLoss,
    entryPrice,
  );
  const peak = finite(
    trade.highestPriceReached ??
      raw.peak_price ??
      raw.highestPriceReached,
    entryPrice,
  );

  return {
    ...trade,
    symbol: symbol.endsWith("USDT") ? symbol : `${symbol}USDT`,
    entryPrice: Number(entryPrice.toFixed(8)),
    amount: Number(amount.toFixed(8)),
    value: Number((value > 0 ? value : entryPrice * amount).toFixed(4)),
    stopLoss: Number(stopLoss.toFixed(8)),
    highestPriceReached: Number(peak.toFixed(8)),
    direction:
      trade.direction ??
      (raw.direction as DemoTrade["direction"]) ??
      (trade.type === "sell" ? "SHORT" : "LONG"),
    status: trade.status ?? "open",
  };
}

export function coerceOpenPositionList(trades: DemoTrade[]): DemoTrade[] {
  const out: DemoTrade[] = [];
  for (const t of trades) {
    const leg = coerceDemoTradeFields(t);
    if (leg) out.push(leg);
  }
  return out;
}
