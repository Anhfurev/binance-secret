import { formatAssetPrice, formatNavUsd } from "@/lib/trading/paper-scalp-metrics-format";
import { resolvePaperLiveMarkPrice } from "@/lib/trading/paper-scalp-mark-price";
import type { Scalp1mSnapshot } from "@/lib/trading/paper-scalp-indicators";
import { isPaperShortLeg } from "@/lib/trading/paper-scalp-leg-side";
import {
  applyTrailingProfitState,
  resolveLegAtr14,
} from "@/lib/trading/paper-scalp-trailing-exit";
import type { CoinData, DemoAccount, DemoTrade } from "@/lib/types";

/** Total layers per leg (base + scale-ins). */
export const MAX_PYRAMID_LAYERS = 3;

/** Each scale-in uses 50% of the initial layer notional. */
export const PYRAMID_LAYER_SIZE_MULT = 0.5;

/** Mark must clear original entry by this × ATR14. */
export const PYRAMID_ATR_EXTENSION_MULT = 1.2;

export type PyramidEligibility = {
  eligible: boolean;
  reason?: string;
};

export type PyramidLayerResult = {
  account: DemoAccount;
  pyramided: boolean;
  addedUsdt?: number;
  trade?: DemoTrade;
};

function normalizeSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

function patchOpenLeg(
  account: DemoAccount,
  tradeId: string,
  trade: DemoTrade,
): DemoAccount {
  return {
    ...account,
    openPositions: account.openPositions.map((p) =>
      p.id === tradeId ? trade : p,
    ),
  };
}

export function resolveOriginalEntryPrice(trade: DemoTrade): number {
  return trade.originalEntryPrice ?? trade.entryPrice;
}

export function resolveInitialPositionValueUsdt(trade: DemoTrade): number {
  if (trade.initialPositionValueUsdt && trade.initialPositionValueUsdt > 0) {
    return trade.initialPositionValueUsdt;
  }
  const layers = 1 + (trade.pyramidLayers ?? 0);
  return trade.value / layers;
}

export function currentPyramidLayer(trade: DemoTrade): number {
  return 1 + (trade.pyramidLayers ?? 0);
}

export function evaluatePyramidEligibility(params: {
  trade: DemoTrade;
  mark: number;
  atr14: number;
  freeCashUsdt: number;
}): PyramidEligibility {
  const { trade, mark, atr14, freeCashUsdt } = params;
  const pyramidLayers = trade.pyramidLayers ?? 0;

  if (pyramidLayers >= MAX_PYRAMID_LAYERS - 1) {
    return { eligible: false, reason: "max-layers" };
  }

  const originalEntry = resolveOriginalEntryPrice(trade);
  const extension = atr14 * PYRAMID_ATR_EXTENSION_MULT;
  const minMark = originalEntry + extension;

  if (mark < minMark) {
    return { eligible: false, reason: "insufficient-atr-extension" };
  }

  if (trade.stopLoss < originalEntry) {
    return { eligible: false, reason: "stop-below-breakeven" };
  }

  const layerUsdt = Number(
    (resolveInitialPositionValueUsdt(trade) * PYRAMID_LAYER_SIZE_MULT).toFixed(4),
  );

  if (layerUsdt <= 0 || freeCashUsdt < layerUsdt) {
    return { eligible: false, reason: "insufficient-free-cash" };
  }

  return { eligible: true };
}

function blendPyramidLayer(
  trade: DemoTrade,
  mark: number,
  layerUsdt: number,
): DemoTrade {
  const layerAmount = Number((layerUsdt / mark).toFixed(6));
  const totalAmount = Number((trade.amount + layerAmount).toFixed(6));
  const blendedEntry = Number(
    (
      (trade.entryPrice * trade.amount + mark * layerAmount) /
      totalAmount
    ).toFixed(8),
  );
  const totalValue = Number((trade.value + layerUsdt).toFixed(4));
  const pyramidLayers = (trade.pyramidLayers ?? 0) + 1;
  const pyramidAddedUsdt = Number(
    ((trade.pyramidAddedUsdt ?? 0) + layerUsdt).toFixed(4),
  );

  return {
    ...trade,
    entryPrice: blendedEntry,
    amount: totalAmount,
    value: totalValue,
    pyramidLayers,
    pyramidAddedUsdt,
    originalEntryPrice: resolveOriginalEntryPrice(trade),
    initialPositionValueUsdt: resolveInitialPositionValueUsdt(trade),
    highestPriceReached: mark,
    executionNotes: [
      ...(trade.executionNotes ?? []),
      `pyramid L${pyramidLayers} +$${layerUsdt} @ ${formatAssetPrice(mark)}`,
    ],
    tags: [...(trade.tags ?? []), "pyramid", `layer-${pyramidLayers}`],
  };
}

/**
 * Scale into a winning leg — 50% of initial notional, blended entry, fresh ATR trail.
 */
export function tryPyramidLayerOnOpenLeg(params: {
  account: DemoAccount;
  trade: DemoTrade;
  snapshots: Map<string, Scalp1mSnapshot>;
  marketCoins: CoinData[];
}): PyramidLayerResult {
  const { account, trade, snapshots, marketCoins } = params;
  if (isPaperShortLeg(trade)) {
    return { account, pyramided: false };
  }
  const sym = normalizeSymbol(trade.symbol);
  const snap = snapshots.get(sym);
  const mark = resolvePaperLiveMarkPrice(
    sym,
    marketCoins,
    snap?.close ?? trade.entryPrice,
  );
  const atr14 = resolveLegAtr14(snap, trade);
  const freeCashUsdt = account.currentBalance;

  const gate = evaluatePyramidEligibility({
    trade,
    mark,
    atr14,
    freeCashUsdt,
  });

  if (!gate.eligible) {
    return { account, pyramided: false };
  }

  const layerUsdt = Number(
    (resolveInitialPositionValueUsdt(trade) * PYRAMID_LAYER_SIZE_MULT).toFixed(4),
  );

  const blended = blendPyramidLayer(trade, mark, layerUsdt);
  const trailed = applyTrailingProfitState(blended, mark, atr14).trade;

  const nextAccount = patchOpenLeg(
    {
      ...account,
      currentBalance: Number(
        Math.max(0, account.currentBalance - layerUsdt).toFixed(4),
      ),
    },
    trade.id,
    trailed,
  );

  return {
    account: nextAccount,
    pyramided: true,
    addedUsdt: layerUsdt,
    trade: trailed,
  };
}

export function formatPyramidLegSuffix(trade: DemoTrade): string {
  const layer = currentPyramidLayer(trade);
  const parts: string[] = [`(Layer: ${layer}/${MAX_PYRAMID_LAYERS})`];

  const added = trade.pyramidAddedUsdt ?? 0;
  if (added > 0) {
    parts.push(`[Pyramided +$${formatNavUsd(added)} USDT]`);
  }

  return parts.join(" ");
}
