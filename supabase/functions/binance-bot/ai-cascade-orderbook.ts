// @ts-nocheck
import type { IndicatorSnapshot } from "./types.ts";

export type OrderBookLevel = { price: number; volume: number };

export type OrderBookTop10Snapshot = {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  imbalance_ratio: number;
  spread_bps: number | null;
};

export function formatOrderBookLevels(
  levels: Array<[number, number]> | undefined,
  depth = 10,
): OrderBookLevel[] {
  const out: OrderBookLevel[] = [];
  for (const row of levels ?? []) {
    if (out.length >= depth) break;
    const price = Number(row?.[0]);
    const volume = Number(row?.[1]);
    if (!Number.isFinite(price) || !Number.isFinite(volume) || price <= 0) continue;
    out.push({ price, volume });
  }
  return out;
}

export function buildOrderBookTop10FromSnapshot(
  snapshot: IndicatorSnapshot,
): OrderBookTop10Snapshot {
  const ob = snapshot.order_book_top10;
  if (ob) {
    return {
      bids: ob.bids,
      asks: ob.asks,
      imbalance_ratio: Number(snapshot.imbalance_ratio ?? 1),
      spread_bps: snapshot.spreadBps ?? null,
    };
  }
  return {
    bids: [],
    asks: [],
    imbalance_ratio: Number(snapshot.imbalance_ratio ?? 1),
    spread_bps: snapshot.spreadBps ?? null,
  };
}

export function computeTop10ImbalanceRatio(
  bids: OrderBookLevel[],
  asks: OrderBookLevel[],
): number {
  const bidVol = bids.reduce((s, l) => s + Math.max(0, l.volume), 0);
  const askVol = asks.reduce((s, l) => s + Math.max(0, l.volume), 0);
  if (askVol > 0) return Number((bidVol / askVol).toFixed(6));
  return bidVol > 0 ? 99 : 1;
}
