/**
 * Client hoisted market cache — mirrors edge `marketCache` pattern for O(1) tick reads.
 * Updates are coalesced per animation frame to avoid rerender storms.
 */

import { normalizeTradingSymbol } from "@/lib/market/symbol";

type PriceRow = {
  price: number;
  updatedAtMs: number;
  source: "ws" | "seed" | "poll";
};

const priceBySymbol = new Map<string, PriceRow>();
const listenersBySymbol = new Map<string, Set<() => void>>();
const pendingSymbols = new Set<string>();
let flushScheduled = false;

function scheduleFlush(): void {
  if (flushScheduled || typeof window === "undefined") return;
  flushScheduled = true;
  requestAnimationFrame(() => {
    flushScheduled = false;
    const symbols = Array.from(pendingSymbols);
    pendingSymbols.clear();
    for (const sym of symbols) {
      const subs = listenersBySymbol.get(sym);
      if (!subs) continue;
      for (const fn of subs) fn();
    }
  });
}

export function getLivePriceFromCache(symbol: string): number | null {
  const sym = normalizeTradingSymbol(symbol);
  const row = priceBySymbol.get(sym);
  return row && Number.isFinite(row.price) && row.price > 0 ? row.price : null;
}

export function getLivePriceMeta(symbol: string): PriceRow | null {
  const sym = normalizeTradingSymbol(symbol);
  return priceBySymbol.get(sym) ?? null;
}

export function setLivePriceInCache(
  symbol: string,
  price: number,
  source: PriceRow["source"] = "ws",
): void {
  const sym = normalizeTradingSymbol(symbol);
  const px = Number(price);
  if (!sym || !Number.isFinite(px) || px <= 0) return;
  const prev = priceBySymbol.get(sym);
  if (prev && prev.price === px && prev.source === source) return;
  priceBySymbol.set(sym, { price: px, updatedAtMs: Date.now(), source });
  pendingSymbols.add(sym);
  scheduleFlush();
}

export function subscribeLivePrice(symbol: string, onStoreChange: () => void): () => void {
  const sym = normalizeTradingSymbol(symbol);
  if (!sym) return () => undefined;
  let set = listenersBySymbol.get(sym);
  if (!set) {
    set = new Set();
    listenersBySymbol.set(sym, set);
  }
  set.add(onStoreChange);
  return () => {
    set?.delete(onStoreChange);
    if (set && set.size === 0) listenersBySymbol.delete(sym);
  };
}

export function clearLivePriceCache(): void {
  priceBySymbol.clear();
  pendingSymbols.clear();
}
