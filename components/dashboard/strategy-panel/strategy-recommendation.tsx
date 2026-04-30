"use client";

import { AlertTriangle, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getRiskBandStyle } from "./strategy-engine";
import type { Strategy, StrategySignal } from "./types";

interface StrategyRecommendationProps {
  t: (en: string, mn: string) => string;
  strategy: Strategy;
  hasTradeSignal: boolean;
  confidencePercent: number;
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

export function StrategyRecommendation({
  t,
  strategy,
  hasTradeSignal,
  confidencePercent,
}: StrategyRecommendationProps) {
  return (
    <div className={cn("rounded-lg border p-3", signalBg(strategy.signal))}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            {t("Recommended", "Зөвлөмж")}
          </span>
        </div>
        <Badge className={cn("uppercase bg-white", signalColor(strategy.signal))}>
          {signalLabel(strategy.signal, t)}
        </Badge>
      </div>

      <p className="mt-1 text-sm font-medium text-foreground">
        {t(strategy.name, strategy.nameMn)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t(strategy.description, strategy.descriptionMn)}
      </p>

      <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
        <Badge variant="secondary">{t("Win rate", "Ялалт")} {strategy.winRate}%</Badge>
        <Badge variant="secondary">R:R {strategy.riskReward}</Badge>
        <Badge variant="secondary">{t("Confidence", "Итгэлцэл")} {strategy.confidence}%</Badge>
        <Badge variant="secondary">{t("Size", "Хэмжээ")} {strategy.positionSizePct}%</Badge>
        <Badge variant="outline" className={cn("border", getRiskBandStyle(strategy.riskBand))}>
          {t("Risk", "Эрсдэл")} {strategy.riskBand}
        </Badge>
      </div>

      <div className="mt-3 space-y-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{t("Confidence meter", "Итгэлцлийн хэмжүүр")}</span>
          <span>{confidencePercent}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              strategy.signal === "long"
                ? "bg-primary"
                : strategy.signal === "short"
                  ? "bg-destructive"
                  : "bg-muted-foreground",
            )}
            style={{ width: `${confidencePercent}%` }}
          />
        </div>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("Invalidation", "Хүчингүй болох нөхцөл")}:{" "}
        {t(strategy.invalidation, strategy.invalidationMn)}
      </p>

      {!hasTradeSignal && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-100/60 p-2 text-[11px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
          <span>
            {t(
              "No clean setup right now. Preserve capital and wait for confirmation.",
              "Одоогоор цэвэр setup алга. Капиталаа хамгаалаад баталгаажилт хүлээ.",
            )}
          </span>
        </div>
      )}
    </div>
  );
}
