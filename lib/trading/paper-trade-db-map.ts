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
  const extra =
    row.extra && typeof row.extra === "object"
      ? (row.extra as Record<string, unknown>)
      : {};
  const paperLegId = str(extra.paper_leg_id);
  if (!paperLegId) return null;

  const statusRaw = str(row.status, "open").toLowerCase();
  const status =
    statusRaw === "open"
      ? "open"
      : statusRaw === "stopped"
        ? "stopped"
        : "closed";

  const type = str(row.type, "buy") === "sell" ? "sell" : "buy";
  const directionRaw = str(extra.direction).toUpperCase();
  const direction: "LONG" | "SHORT" | undefined =
    directionRaw === "SHORT" || directionRaw === "LONG"
      ? directionRaw
      : type === "sell"
        ? "SHORT"
        : "LONG";

  const openedAt = row.opened_at ? new Date(String(row.opened_at)) : new Date();
  const closedAt = row.closed_at ? new Date(String(row.closed_at)) : undefined;

  return {
    id: paperLegId,
    signalId: str(row.signalId, "paper-scalp"),
    coinId: str(row.coinId, str(row.symbol, "unknown")),
    symbol: str(row.symbol),
    type,
    direction,
    leverage: num(extra.leverage, 1) || 1,
    marginUsed: num(extra.margin_used_usdt, num(row.value)),
    entryPrice: num(row.entryPrice),
    exitPrice: row.exitPrice != null ? num(row.exitPrice) : undefined,
    amount: num(row.amount),
    value: num(row.value),
    status,
    pnl: row.pnl != null ? num(row.pnl) : undefined,
    pnlPercent: row.pnlPercent != null ? num(row.pnlPercent) : undefined,
    openedAt,
    closedAt,
    stopLoss: num(row.stopLoss),
    takeProfit: num(row.takeProfit),
    highestPriceReached:
      extra.highest_price_reached != null
        ? num(extra.highest_price_reached)
        : undefined,
    lowestPriceReached:
      extra.lowest_price_reached != null
        ? num(extra.lowest_price_reached)
        : undefined,
    velocityTakeProfitSecured: extra.velocity_tp_secured === true,
    pyramidLayers: num(extra.pyramid_layers, 0),
    notes: row.notes != null ? str(row.notes) : undefined,
    tags: Array.isArray(extra.tags) ? extra.tags.map(String) : ["paper-scalp"],
    followedSignal: row.followedSignal === true,
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
    (a, b) => (b.closedAt?.getTime() ?? b.openedAt.getTime()) -
      (a.closedAt?.getTime() ?? a.openedAt.getTime()),
  );
}
