"use client";

import { AssetTrackerCard } from "@/components/wallet/asset-tracker-card";
import type { DemoTrade } from "@/lib/types";

type OpenPositionTrackersProps = {
  positions: DemoTrade[];
  priceBySymbol?: Map<string, number>;
  isLoading?: boolean;
};

export function OpenPositionTrackers({
  positions,
  priceBySymbol,
  isLoading = false,
}: OpenPositionTrackersProps) {
  if (!positions.length) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {positions.map((trade) => {
        const symbol = String(trade.symbol ?? "").toUpperCase();
        const base = symbol.replace(/USDT$/, "");
        const seedPrice =
          priceBySymbol?.get(base) ?? trade.currentPrice ?? trade.entryPrice;
        return (
          <AssetTrackerCard
            key={trade.id}
            symbol={symbol}
            tokenQuantity={Number(trade.amount ?? 0)}
            initialPurchasePrice={Number(trade.entryPrice ?? trade.price ?? 0)}
            seedPrice={Number(seedPrice)}
            isLoading={isLoading}
          />
        );
      })}
    </div>
  );
}
