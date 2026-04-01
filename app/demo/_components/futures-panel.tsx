"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Zap, ArrowUpRight, ArrowDownRight, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/components/language-provider";

const LEVERAGE_OPTIONS = [1, 2, 3, 5, 10, 20, 25, 50];

interface FuturesPair {
  symbol: string;
  base: string;
  price: number;
}

interface FuturesPanelProps {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  pairs: FuturesPair[];
  selectedPair: FuturesPair;
  onPairChange: (symbol: string) => void;
  direction: "LONG" | "SHORT";
  onDirectionChange: (d: "LONG" | "SHORT") => void;
  leverage: number;
  onLeverageChange: (lev: number) => void;
  margin: number[];
  onMarginChange: (m: number[]) => void;
  currentBalance: number;
  circuitBreakerActive: boolean;
  walletMode: string;
  onOpenTrade: () => void;
}

export function FuturesPanel({
  enabled,
  onEnabledChange,
  pairs,
  selectedPair,
  onPairChange,
  direction,
  onDirectionChange,
  leverage,
  onLeverageChange,
  margin,
  onMarginChange,
  currentBalance,
  circuitBreakerActive,
  walletMode,
  onOpenTrade,
}: FuturesPanelProps) {
  const { t } = useLanguage();

  const liqPrice =
    direction === "LONG"
      ? selectedPair.price - (selectedPair.price / leverage) * 0.9
      : selectedPair.price + (selectedPair.price / leverage) * 0.9;

  return (
    <Card className="mb-6 border-border/50 bg-card/60 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-warning" />
            {t("Futures Trading", "Фьючерс арилжаа")}
            <Badge variant="outline" className="ml-2 text-[10px]">
              DEMO
            </Badge>
          </CardTitle>
          <Switch checked={enabled} onCheckedChange={onEnabledChange} />
        </div>
      </CardHeader>
      {enabled && (
        <CardContent className="space-y-4">
          {/* Pair Selection */}
          <div className="flex flex-wrap gap-2">
            {pairs.map((pair) => (
              <Button
                key={pair.symbol}
                size="sm"
                variant={
                  selectedPair.symbol === pair.symbol ? "default" : "outline"
                }
                onClick={() => onPairChange(pair.symbol)}
                className="text-xs"
              >
                {pair.symbol}
              </Button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Direction */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                {t("Direction", "Чиглэл")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={direction === "LONG" ? "default" : "outline"}
                  onClick={() => onDirectionChange("LONG")}
                  className={cn(
                    "gap-2",
                    direction === "LONG" && "bg-success hover:bg-success/90",
                  )}
                >
                  <ArrowUpRight className="h-4 w-4" />
                  LONG
                </Button>
                <Button
                  variant={direction === "SHORT" ? "default" : "outline"}
                  onClick={() => onDirectionChange("SHORT")}
                  className={cn(
                    "gap-2",
                    direction === "SHORT" &&
                      "bg-destructive hover:bg-destructive/90",
                  )}
                >
                  <ArrowDownRight className="h-4 w-4" />
                  SHORT
                </Button>
              </div>
            </div>

            {/* Leverage */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">
                  {t("Leverage", "Хөшүүрэг")}
                </p>
                <Badge
                  variant={
                    leverage > 10
                      ? "destructive"
                      : leverage > 5
                        ? "default"
                        : "secondary"
                  }
                >
                  {leverage}x
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1">
                {LEVERAGE_OPTIONS.map((lev) => (
                  <Button
                    key={lev}
                    size="sm"
                    variant={leverage === lev ? "default" : "ghost"}
                    onClick={() => onLeverageChange(lev)}
                    className="h-7 px-2 text-xs"
                  >
                    {lev}x
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Margin & Position Info */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">
                {t("Margin (USDT)", "Маржин (USDT)")}
              </p>
              <span className="text-sm text-muted-foreground">
                ${margin[0].toLocaleString()}
              </span>
            </div>
            <Slider
              value={margin}
              onValueChange={onMarginChange}
              min={100}
              max={Math.min(25000, Math.floor(currentBalance))}
              step={100}
            />
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-secondary/30 p-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Position Size</p>
                <p className="font-mono font-bold text-foreground">
                  ${(margin[0] * leverage).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Entry Price</p>
                <p className="font-mono font-bold text-foreground">
                  ${selectedPair.price.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Est. Liq. Price</p>
                <p className="font-mono font-bold text-destructive">
                  ${liqPrice.toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          <Button
            className={cn(
              "w-full",
              direction === "LONG"
                ? "bg-success hover:bg-success/90"
                : "bg-destructive hover:bg-destructive/90",
            )}
            onClick={onOpenTrade}
            disabled={circuitBreakerActive || walletMode === "real"}
          >
            <Zap className="mr-2 h-4 w-4" />
            {t(
              `Open ${direction} ${selectedPair.symbol} (${leverage}x)`,
              `${selectedPair.symbol} ${direction} нээх (${leverage}x)`,
            )}
          </Button>

          {leverage > 10 && (
            <p className="flex items-center gap-1 text-xs text-warning">
              <AlertTriangle className="h-3 w-3" />
              {t(
                "High leverage increases liquidation risk significantly. Use caution.",
                "Өндөр хөшүүрэг нь татан буулгалтын эрсдэлийг ихээхэн нэмэгдүүлнэ.",
              )}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
