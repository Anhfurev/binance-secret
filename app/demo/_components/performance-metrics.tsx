"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

interface PerformanceStats {
  profitFactor: string | number;
  expectancy: string | number;
  sharpeRatio: string | number;
  avgTradeDuration: string;
  tradesPerWeek: string | number;
}

interface PerformanceMetricsProps {
  stats: PerformanceStats;
}

export function PerformanceMetrics({ stats }: PerformanceMetricsProps) {
  return (
    <Card className="mb-8 border-border/50 bg-card/60 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          Performance Metrics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-5">
          <div className="text-center">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Profit Factor
            </p>
            <p className="mt-1 text-xl font-bold text-foreground">
              {stats.profitFactor}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Gross Win / Gross Loss
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Expectancy
            </p>
            <p className="mt-1 text-xl font-bold text-success">
              ${stats.expectancy}
            </p>
            <p className="text-[10px] text-muted-foreground">Avg per trade</p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Sharpe Ratio
            </p>
            <p className="mt-1 text-xl font-bold text-foreground">
              {stats.sharpeRatio}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Risk-adjusted return
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Avg Trade
            </p>
            <p className="mt-1 text-xl font-bold text-foreground">
              {stats.avgTradeDuration}
            </p>
            <p className="text-[10px] text-muted-foreground">Hold duration</p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Activity
            </p>
            <p className="mt-1 text-xl font-bold text-foreground">
              {stats.tradesPerWeek}
            </p>
            <p className="text-[10px] text-muted-foreground">Trades per week</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
