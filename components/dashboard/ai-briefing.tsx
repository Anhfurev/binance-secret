"use client";

import {
  Brain,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/components/language-provider";
import { buildDashboardAiAnalysis } from "@/lib/ai-analysis";
import type { CoinData, GrowthCandidate, SentimentData } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AiBriefingProps {
  coins: CoinData[];
  candidates: GrowthCandidate[];
  sentiment: SentimentData;
}

export function AiBriefing({ coins, candidates, sentiment }: AiBriefingProps) {
  const { t } = useLanguage();
  const analysis = buildDashboardAiAnalysis(coins, candidates, sentiment);

  const biasUi =
    analysis.bias === "bullish"
      ? {
          label: t("Bullish Bias", "Өсөх төлөв"),
          icon: TrendingUp,
          className: "bg-success/15 text-success border-success/30",
        }
      : analysis.bias === "bearish"
        ? {
            label: t("Bearish Bias", "Буурах төлөв"),
            icon: TrendingDown,
            className:
              "bg-destructive/15 text-destructive border-destructive/30",
          }
        : {
            label: t("Neutral Bias", "Төвийг сахисан төлөв"),
            icon: Brain,
            className: "bg-muted text-muted-foreground border-border",
          };

  const riskUi =
    analysis.riskLevel === "low"
      ? {
          label: t("Low Risk", "Бага эрсдэл"),
          icon: ShieldCheck,
          className: "text-success",
        }
      : analysis.riskLevel === "high"
        ? {
            label: t("High Risk", "Өндөр эрсдэл"),
            icon: ShieldAlert,
            className: "text-destructive",
          }
        : {
            label: t("Medium Risk", "Дунд эрсдэл"),
            icon: ShieldQuestion,
            className: "text-warning",
          };

  const BiasIcon = biasUi.icon;
  const RiskIcon = riskUi.icon;

  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Brain className="h-4 w-4 text-primary" />
          {t("AI Analysis Brief", "AI шинжилгээний товч тайлан")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn("gap-1.5", biasUi.className)}>
            <BiasIcon className="h-3.5 w-3.5" />
            {biasUi.label}
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            <RiskIcon className={cn("h-3.5 w-3.5", riskUi.className)} />
            {riskUi.label}
          </Badge>
          <Badge variant="secondary">
            {t("Confidence", "Итгэлцэл")}: {analysis.confidence}%
          </Badge>
        </div>

        <p className="text-sm text-muted-foreground">
          {t(analysis.summary, analysis.summaryMn)}
        </p>

        <div className="space-y-2">
          {analysis.actions.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-border/50 bg-secondary/30 p-3"
            >
              <p className="text-sm font-medium text-foreground">
                {t(item.title, item.titleMn)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t(item.detail, item.detailMn)}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
