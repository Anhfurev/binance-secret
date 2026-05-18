export type TokenHoldingRow = {
  free: number;
  locked: number;
};

export type HoldingsMap = Record<string, TokenHoldingRow>;

export type OpenPositionNavInput = {
  symbol: string;
  amount: number;
  livePrice?: number;
  entryPrice?: number;
};

export function normalizeBaseAsset(symbol: string): string {
  return String(symbol ?? "").toUpperCase().replace(/USDT$/, "");
}

export function resolveLivePriceForSymbol(
  symbol: string,
  priceBySymbol: Map<string, number> | Record<string, number>,
): number {
  const upper = String(symbol ?? "").toUpperCase();
  const base = normalizeBaseAsset(upper);
  const lookup = priceBySymbol instanceof Map
    ? (key: string) => priceBySymbol.get(key)
    : (key: string) => priceBySymbol[key];
  return Number(
    lookup(upper) ??
      lookup(base) ??
      lookup(`${base}USDT`) ??
      0,
  );
}

/** NAV = available USDT + Σ (token qty × live price). */
export function computePortfolioNavUsd(params: {
  availableUsdt: number;
  openPositions: OpenPositionNavInput[];
  priceBySymbol: Map<string, number> | Record<string, number>;
}): {
  navUsd: number;
  positionsMarketValueUsd: number;
  availableUsdt: number;
} {
  const availableUsdt = Math.max(0, Number(params.availableUsdt) || 0);
  let positionsMarketValueUsd = 0;
  for (const pos of params.openPositions) {
    const amount = Number(pos.amount) || 0;
    if (!(amount > 0)) continue;
    const px = Number(pos.livePrice) > 0
      ? Number(pos.livePrice)
      : resolveLivePriceForSymbol(pos.symbol, params.priceBySymbol);
    if (px > 0) positionsMarketValueUsd += amount * px;
  }
  const navUsd = Number((availableUsdt + positionsMarketValueUsd).toFixed(2));
  return {
    navUsd,
    positionsMarketValueUsd: Number(positionsMarketValueUsd.toFixed(2)),
    availableUsdt,
  };
}

export function formatNavUsd(navUsd: number, locale = "en-US"): string {
  if (!Number.isFinite(navUsd)) return "—";
  return `$${navUsd.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function holdingsToOpenPositionInputs(
  holdings: HoldingsMap | null | undefined,
  priceBySymbol: Map<string, number> | Record<string, number>,
): OpenPositionNavInput[] {
  if (!holdings) return [];
  return Object.entries(holdings)
    .filter(([base]) => base !== "USDT")
    .map(([base, row]) => ({
      symbol: `${base}USDT`,
      amount: Number(row?.free ?? 0) + Number(row?.locked ?? 0),
      livePrice: resolveLivePriceForSymbol(`${base}USDT`, priceBySymbol),
    }))
    .filter((p) => p.amount > 0);
}
