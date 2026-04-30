"use client";

import { BarChart3, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Strategy, StrategySignal, StrategyType } from "./types";

interface StrategyGridProps {
  t: (en: string, mn: string) => string;
  strategies: Strategy[];
}

const signalColor = (signal: StrategySignal) =>
  signal === "long"
    ? "text-primary"
    : signal === "short"
      ? "text-destructive"
      : "text-muted-foreground";

const signalBg = (signal: StrategySignal) =>
  signal === "long"
    ? "bg-primary/10 border-primary/30"
    : signal === "short"
      ? "bg-destructive/10 border-destructive/30"
      : "bg-muted/50 border-border/50";

const signalLabel = (
  signal: StrategySignal,
  t: (en: string, mn: string) => string,
) => {
  if (signal === "long") return t("LONG", "АВАХ");
  if (signal === "short") return t("SHORT", "ЗАРАХ");
  return t("WAIT", "ХҮЛЭЭХ");
};

const typeIcon = (type: StrategyType) => {
  switch (type) {
    case "trend":
      return TrendingUp;
    case "reversal":
      return TrendingDown;
    case "breakout":
      return Zap;
    default:
      return BarChart3;
  }
};

export function StrategyGrid({ t, strategies }: StrategyGridProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {strategies.slice(1).map((strategy) => {
        const Icon = typeIcon(strategy.type);
        return (
          <div
            key={strategy.id}
            className={cn("rounded-lg border p-2.5 transition-colors", signalBg(strategy.signal))}
          >
            <div className="flex items-center justify-between">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <Badge variant="outline" className={cn("text-[9px] uppercase", signalColor(strategy.signal))}>
                {signalLabel(strategy.signal, t)}
              </Badge>
            </div>
            <p className="mt-1.5 text-xs font-semibold text-foreground">
              {t(strategy.name, strategy.nameMn)}
            </p>
            <div className="mt-1 flex gap-1.5 text-[9px] text-muted-foreground">
              <span>{strategy.winRate}% WR</span>
              <span>·</span>
              <span>{strategy.confidence}%</span>
              <span>·</span>
              <span>{strategy.score}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
