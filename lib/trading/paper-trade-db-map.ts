import type { DemoTrade } from "@/lib/types";

type TradeDbRow = Record<string, unknown>;

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function mapUnifiedTradeRow(row: TradeDbRow): DemoTrade | null {
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

function mapLegacyTradeRow(row: TradeDbRow): DemoTrade | null {
  const extra =
    row.extra && typeof row.extra === "object"
      ? (row.extra as Record<string, unknown>)
      : {};
  const paperLegId = str(extra.paper_leg_id);
  const id = paperLegId || str(row.id);
  if (!id) return null;

  const statusRaw = str(row.status, "closed").toLowerCase();
  const status =
    statusRaw === "open"
      ? "open"
      : statusRaw === "stopped"
        ? "stopped"
        : "closed";

  if (status === "open") return null;

  const type = str(row.type, "buy") === "sell" ? "sell" : "buy";
  const directionRaw = str(extra.direction).toUpperCase();
  const direction: "LONG" | "SHORT" | undefined =
    directionRaw === "SHORT" || directionRaw === "LONG"
      ? directionRaw
      : type === "sell"
        ? "SHORT"
        : "LONG";

  const openedAt = row.opened_at
    ? new Date(String(row.opened_at))
    : new Date();
  const closedAt = row.closed_at ? new Date(String(row.closed_at)) : undefined;

  return {
    id,
    signalId: str(row.signalId, "paper-scalp"),
    coinId: str(row.coinId, str(row.symbol, "unknown")),
    symbol: str(row.symbol),
    type,
    direction,
    entryPrice: num(row.entryPrice),
    exitPrice: row.exitPrice != null ? num(row.exitPrice) : undefined,
    amount: num(row.amount),
    value: num(row.value),
    status,
    pnl: row.pnl != null ? num(row.pnl) : undefined,
    pnlPercent: row.pnlPercent != null ? num(row.pnlPercent) : undefined,
    openedAt,
    closedAt,
    notes: row.notes != null ? str(row.notes) : undefined,
    tags: Array.isArray(extra.tags) ? extra.tags.map(String) : ["paper-scalp"],
    followedSignal: row.followedSignal === true,
  };
}

/** Maps unified (snake_case) or legacy (camelCase) `trades` rows. */
export function mapTradeRowToDemo(row: TradeDbRow): DemoTrade | null {
  try {
    if (row.entry_price != null || row.qty != null || row.net_pnl != null) {
      return mapUnifiedTradeRow(row);
    }
    return mapLegacyTradeRow(row);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[paper-trade-db-map] map row failed", { message: err.message });
    return null;
  }
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
