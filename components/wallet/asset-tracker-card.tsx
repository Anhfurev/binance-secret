"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  computeAssetEquity,
  hasValidLivePrice,
} from "@/lib/market/asset-equity";
import { displayAssetSymbol } from "@/lib/market/symbol";
import { useLivePrice } from "@/hooks/use-live-price";

export type AssetTrackerCardProps = {
  symbol: string;
  tokenQuantity: number;
  initialPurchasePrice: number;
  isLoading?: boolean;
  seedPrice?: number | null;
  className?: string;
};

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const pctFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  return usdFormatter.format(value);
}

function formatTokenQty(qty: number): string {
  if (!Number.isFinite(qty)) return "0";
  if (Math.abs(qty) >= 1) {
    return qty.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  return qty.toFixed(8).replace(/\.?0+$/, "");
}

function formatPrice(px: number): string {
  if (!Number.isFinite(px)) return "$0";
  if (px >= 1000) return usdFormatter.format(px);
  if (px >= 1) return `$${px.toFixed(2)}`;
  return `$${px.toFixed(6)}`;
}

function ShimmerBlock({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn(
        "animate-pulse bg-gradient-to-r from-muted via-muted-foreground/15 to-muted",
        className,
      )}
    />
  );
}

function AssetTrackerSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-white p-4 shadow-sm dark:bg-card",
        className,
      )}
    >
      <ShimmerBlock className="h-3 w-24" />
      <ShimmerBlock className="mt-3 h-10 w-40" />
      <ShimmerBlock className="mt-3 h-5 w-32" />
      <ShimmerBlock className="mt-4 h-3 w-48" />
    </div>
  );
}

export function AssetTrackerCard({
  symbol,
  tokenQuantity,
  initialPurchasePrice,
  isLoading: isLoadingProp = false,
  seedPrice,
  className,
}: AssetTrackerCardProps) {
  const { livePrice, isLoading: isPriceLoading } = useLivePrice(symbol, {
    seedPrice,
    enabled: Boolean(symbol),
  });

  const showSkeleton = isLoadingProp || isPriceLoading;
  const assetLabel = displayAssetSymbol(symbol);

  const metrics = useMemo(() => {
    if (!hasValidLivePrice(livePrice)) return null;
    return computeAssetEquity(tokenQuantity, livePrice, initialPurchasePrice);
  }, [livePrice, tokenQuantity, initialPurchasePrice]);

  if (showSkeleton) {
    return <AssetTrackerSkeleton className={className} />;
  }

  if (!metrics) {
    return <AssetTrackerSkeleton className={className} />;
  }

  const { currentEquity, unrealizedPnL, pnlPercentage } = metrics;
  const isPositive = unrealizedPnL >= 0;
  const arrow = isPositive ? "▲" : "▼";
  const pnlColor = isPositive ? "text-emerald-500" : "text-red-500";
  const px = Number(livePrice);

  return (
    <article
      className={cn(
        "rounded-2xl border border-blue-500/25 bg-white p-4 shadow-sm dark:bg-card",
        className,
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-blue-500">
        {assetLabel} Holdings
      </p>
      <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-blue-500">
        {formatUsd(currentEquity)}
      </p>
      <p className={cn("mt-1 flex items-center gap-1 text-sm font-semibold tabular-nums", pnlColor)}>
        <span aria-hidden>{arrow}</span>
        <span>
          {isPositive ? "+" : ""}
          {formatUsd(unrealizedPnL)}
        </span>
        <span className="text-muted-foreground">·</span>
        <span>
          {isPositive ? "+" : ""}
          {pctFormatter.format(pnlPercentage)}%
        </span>
      </p>
      <p className="mt-3 text-xs text-muted-foreground tabular-nums">
        {formatTokenQty(tokenQuantity)} {assetLabel} @ {formatPrice(px)}
      </p>
    </article>
  );
}
