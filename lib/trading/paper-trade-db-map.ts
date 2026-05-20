import type { DemoTrade } from "@/lib/types";

type TradeDbRow = Record<string, unknown>;

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function mapTradeRowToDemo(row: TradeDbRow): DemoTrade | null {
  const closedAt = row.closed_at ? new Date(String(row.closed_at)) : null;
  if (!closedAt || Number.isNaN(closedAt.getTime())) return null;

  const id = str(row.id);
  if (!id) return null;

  const side = str(row.side, "LONG").toUpperCase();
  const isShort = side === "SHORT";
  const entryPrice = num(row.entry_price);
  const exitPrice = num(row.exit_price, entryPrice);
  const qty = num(row.qty);
  const netPnl = num(row.net_pnl);

  return {
    id,
    signalId: str(row.strategy_executed, "paper-scalp"),
    coinId: str(row.symbol, "unknown").replace("USDT", ""),
    symbol: str(row.symbol),
    type: isShort ? "sell" : "buy",
    direction: isShort ? "SHORT" : "LONG",
    entryPrice,
    exitPrice,
    amount: qty,
    value: qty * entryPrice,
    status: netPnl >= 0 ? "closed" : "stopped",
    pnl: netPnl,
    pnlPercent:
      entryPrice > 0 && qty > 0
        ? Number(((netPnl / (qty * entryPrice)) * 100).toFixed(2))
        : undefined,
    openedAt: closedAt,
    closedAt,
    notes: str(row.strategy_executed) || undefined,
    tags: ["paper-scalp"],
    followedSignal: false,
  };
}

export function mergeDemoTradesById(
  primary: DemoTrade[],
  secondary: DemoTrade[],
): DemoTrade[] {
  const byId = new Map<string, DemoTrade>();
  for (const trade of [...secondary, ...primary]) {
    const prev = byId.get(trade.id);
    if (!prev) {
      byId.set(trade.id, trade);
      continue;
    }
    const prevClosed = prev.closedAt?.getTime() ?? 0;
    const nextClosed = trade.closedAt?.getTime() ?? 0;
    if (nextClosed >= prevClosed) byId.set(trade.id, trade);
  }
  return [...byId.values()].sort(
    (a, b) =>
      (b.closedAt?.getTime() ?? b.openedAt.getTime()) -
      (a.closedAt?.getTime() ?? a.openedAt.getTime()),
  );
}
