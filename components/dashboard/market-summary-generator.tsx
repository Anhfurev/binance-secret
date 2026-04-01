"use client";

import { FileText, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  AITradeSignal,
  CoinData,
  PricePrediction,
  WhaleTransaction,
} from "@/lib/types";
import { buildDailyMarketSummary } from "@/lib/ai-analysis";
import { useLanguage } from "@/components/language-provider";

interface MarketSummaryGeneratorProps {
  coins: CoinData[];
  signals: AITradeSignal[];
  predictions: PricePrediction[];
  whales: WhaleTransaction[];
}

export function MarketSummaryGenerator({
  coins,
  signals,
  predictions,
  whales,
}: MarketSummaryGeneratorProps) {
  const { t } = useLanguage();
  const summary = buildDailyMarketSummary({
    coins,
    signals,
    predictions,
    whales,
  });

  const lines = [
    t(summary.btcLine, summary.btcLineMn),
    t(summary.ethLine, summary.ethLineMn),
    t(summary.whaleLine, summary.whaleLineMn),
    t(summary.volatilityLine, summary.volatilityLineMn),
  ];

  return (
    <Card className="border-border/60 bg-card/70 backdrop-blur-sm lg:col-span-12">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <FileText className="h-4 w-4 text-primary" />
          {t("AI Daily Market Summary", "AI өдрийн захын тойм")}
          <Badge variant="outline" className="text-[10px]">
            {t("Auto-generated", "Автомат үүсгэсэн")}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {t(summary.overall, summary.overallMn)}
        </p>

        <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
          <p className="text-xs font-medium text-foreground">
            {t("Daily Market Summary", "Өдрийн захын хураангуй")}
          </p>
          <div className="mt-2 space-y-1.5">
            {lines.map((line, idx) => (
              <p
                key={`daily-summary-line-${idx}`}
                className="text-sm text-muted-foreground"
              >
                {line}
              </p>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {t("Generated", "Үүсгэсэн")}: {summary.generatedAt.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}
