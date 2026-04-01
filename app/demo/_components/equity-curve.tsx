"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Gauge } from "lucide-react";
import { useLanguage } from "@/components/language-provider";

interface EquityCurveProps {
  equityCurve: Array<{ time: string; equity: number }>;
}

export function EquityCurve({ equityCurve }: EquityCurveProps) {
  const { t } = useLanguage();

  if (equityCurve.length <= 1) return null;

  const equities = equityCurve.map((p) => p.equity);
  const min = Math.min(...equities);
  const max = Math.max(...equities);
  const range = max - min || 1;

  const first = equityCurve[0];
  const last = equityCurve[equityCurve.length - 1];
  const pctChange =
    first.equity > 0 ? ((last.equity - first.equity) / first.equity) * 100 : 0;
  const isPositive = last.equity >= first.equity;

  return (
    <Card className="mt-6 border-border/50 bg-card/60 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4 text-primary" />
          {t("Equity Curve", "Капиталын муруй")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex h-32 items-end gap-0.5">
          {equityCurve.map((point, i) => {
            const height = ((point.equity - min) / range) * 100;
            const isUp = i === 0 || point.equity >= equityCurve[i - 1].equity;
            return (
              <div
                key={i}
                className="group relative flex-1"
                style={{ height: "100%" }}
              >
                <div
                  className={cn(
                    "absolute bottom-0 w-full rounded-sm transition-colors",
                    isUp
                      ? "bg-success/70 hover:bg-success"
                      : "bg-destructive/70 hover:bg-destructive",
                  )}
                  style={{ height: `${Math.max(height, 2)}%` }}
                />
                <div className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-[10px] text-popover-foreground shadow-md group-hover:block">
                  ${point.equity.toFixed(0)} — {point.time.slice(5)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>{first.time.slice(5)}</span>
          <span
            className={cn(
              "font-bold",
              isPositive ? "text-success" : "text-destructive",
            )}
          >
            {isPositive ? "+" : ""}
            {pctChange.toFixed(2)}%
          </span>
          <span>{last.time.slice(5)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
