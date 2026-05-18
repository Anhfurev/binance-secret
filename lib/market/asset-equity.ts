export type AssetEquitySnapshot = {
  costBasis: number;
  currentEquity: number;
  unrealizedPnL: number;
  pnlPercentage: number;
};

export function computeAssetEquity(
  tokenQuantity: number,
  livePrice: number,
  initialPurchasePrice: number,
): AssetEquitySnapshot {
  const qty = Number(tokenQuantity);
  const px = Number(livePrice);
  const entry = Number(initialPurchasePrice);
  const costBasis = qty * entry;
  const currentEquity = qty * px;
  const unrealizedPnL = currentEquity - costBasis;
  const pnlPercentage = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : 0;
  return {
    costBasis,
    currentEquity,
    unrealizedPnL,
    pnlPercentage,
  };
}

export function hasValidLivePrice(price: number | null | undefined): boolean {
  return Number.isFinite(price) && Number(price) > 0;
}
