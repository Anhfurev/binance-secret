"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Target,
  AlertTriangle,
} from "lucide-react";

interface StatsGridProps {
  currentBalance: number;
  startingBalance: number;
  totalPnl: number;
  totalPnlPercent: number;
  winRate: number;
  winningTrades: number;
  losingTrades: number;
  maxDrawdown: number;
  currentDrawdown: number;
  formatPrice: (price: number) => string;
}

export function StatsGrid({
  currentBalance,
  startingBalance,
  totalPnl,
  totalPnlPercent,
  winRate,
  winningTrades,
  losingTrades,
  maxDrawdown,
  currentDrawdown,
  formatPrice,
}: StatsGridProps) {
  return (
    <div className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Balance</p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                ${currentBalance.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Started: ${startingBalance.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg bg-primary/20 p-3">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total P&L</p>
              <p
                className={cn(
                  "mt-1 text-2xl font-bold",
                  totalPnl >= 0 ? "text-success" : "text-destructive",
                )}
              >
                {totalPnl >= 0 ? "+" : ""}
                {formatPrice(totalPnl)}
              </p>
              <p
                className={cn(
                  "mt-1 text-xs",
                  totalPnlPercent >= 0 ? "text-success" : "text-destructive",
                )}
              >
                {totalPnlPercent >= 0 ? "+" : ""}
                {totalPnlPercent.toFixed(2)}%
              </p>
            </div>
            <div
              className={cn(
                "rounded-lg p-3",
                totalPnl >= 0 ? "bg-success/20" : "bg-destructive/20",
              )}
            >
              {totalPnl >= 0 ? (
                <TrendingUp className="h-5 w-5 text-success" />
              ) : (
                <TrendingDown className="h-5 w-5 text-destructive" />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Win Rate</p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {winRate.toFixed(1)}%
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {winningTrades}W / {losingTrades}L
              </p>
            </div>
            <div className="rounded-lg bg-info/20 p-3">
              <Target className="h-5 w-5 text-info" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Max Drawdown</p>
              <p className="mt-1 text-2xl font-bold text-destructive">
                -{maxDrawdown.toFixed(1)}%
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Current: -{currentDrawdown.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-lg bg-destructive/20 p-3">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
