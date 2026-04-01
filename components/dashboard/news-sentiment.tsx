"use client";

import {
  Newspaper,
  TrendingUp,
  TrendingDown,
  Minus,
  Gauge,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { NewsItem, SentimentData } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useLanguage } from "@/components/language-provider";

interface NewsSentimentProps {
  news: NewsItem[];
  sentiment: SentimentData;
  isLoading?: boolean;
}

const impactConfig = {
  positive: {
    icon: TrendingUp,
    class: "text-success",
    label: "Bullish",
  },
  negative: {
    icon: TrendingDown,
    class: "text-destructive",
    label: "Bearish",
  },
  neutral: {
    icon: Minus,
    class: "text-muted-foreground",
    label: "Neutral",
  },
};

function SentimentMeter({
  value,
  label,
  sublabel,
}: {
  value: number;
  label: string;
  sublabel: string;
}) {
  const getColor = (val: number) => {
    if (val <= 25) return "bg-destructive [&>div]:bg-destructive";
    if (val <= 45) return "bg-warning/50 [&>div]:bg-warning";
    if (val <= 55) return "bg-muted [&>div]:bg-muted-foreground";
    if (val <= 75) return "bg-success/50 [&>div]:bg-success";
    return "bg-success [&>div]:bg-success";
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">{sublabel}</span>
      </div>
      <div className="relative">
        <Progress value={value} className={cn("h-2", getColor(value))} />
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>Fear</span>
          <span>Greed</span>
        </div>
      </div>
      <div className="flex items-center justify-center">
        <span
          className={cn(
            "text-3xl font-bold",
            value <= 25 && "text-destructive",
            value > 25 && value <= 45 && "text-warning",
            value > 45 && value <= 55 && "text-muted-foreground",
            value > 55 && value <= 75 && "text-success",
            value > 75 && "text-success",
          )}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

export function NewsSentiment({
  news,
  sentiment,
  isLoading,
}: NewsSentimentProps) {
  const { t } = useLanguage();

  const impactLabels = {
    positive: t("Bullish", "Өсөх төлөв"),
    negative: t("Bearish", "Буурах төлөв"),
    neutral: t("Neutral", "Төвийг сахисан"),
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Sentiment Meters */}
      <Card className="card-hover border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Gauge className="h-4 w-4 text-primary" />
            {t("Market Sentiment", "Зах зээлийн хандлага")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="space-y-4">
              <div className="h-20 animate-pulse rounded-lg bg-secondary/50" />
              <div className="h-20 animate-pulse rounded-lg bg-secondary/50" />
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-border/50 bg-secondary/20 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-accent" />
                  <span className="text-sm font-medium">
                    {t("Fear & Greed Index", "Айдас ба Шунал индекс")}
                  </span>
                </div>
                <SentimentMeter
                  value={sentiment.fearGreedIndex}
                  label=""
                  sublabel={sentiment.fearGreedLabel}
                />
              </div>

              <div className="rounded-xl border border-border/50 bg-secondary/20 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">
                    {t("Social Sentiment", "Нийгмийн сэтгэл зүй")}
                  </span>
                </div>
                <SentimentMeter
                  value={sentiment.socialSentiment}
                  label=""
                  sublabel={sentiment.socialSentimentLabel}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* News Feed */}
      <Card className="card-hover border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Newspaper className="h-4 w-4 text-primary" />
            {t("Latest News", "Сүүлийн мэдээ")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-70 px-4 pb-4">
            <div className="space-y-3">
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-24 animate-pulse rounded-lg bg-secondary/50"
                    />
                  ))
                : news.map((item, index) => {
                    const impact = impactConfig[item.marketImpact];
                    const Icon = impact.icon;

                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "rounded-lg border border-border/50 bg-secondary/20 p-3 transition-colors hover:bg-secondary/40",
                          "animate-in fade-in slide-in-from-bottom-2",
                          index === 0 && "animate-stagger-1",
                          index === 1 && "animate-stagger-2",
                          index === 2 && "animate-stagger-3",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-medium leading-tight line-clamp-2">
                            {item.title}
                          </h4>
                          <Badge
                            variant="outline"
                            className={cn(
                              "shrink-0 gap-1",
                              item.marketImpact === "positive" &&
                                "border-success/30 bg-success/10 text-success",
                              item.marketImpact === "negative" &&
                                "border-destructive/30 bg-destructive/10 text-destructive",
                              item.marketImpact === "neutral" &&
                                "border-border bg-muted text-muted-foreground",
                            )}
                          >
                            <Icon className="h-3 w-3" />
                            {impactLabels[item.marketImpact]}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                          {item.aiSummary}
                        </p>
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium">{item.source}</span>
                          <span>•</span>
                          <span>
                            {formatDistanceToNow(new Date(item.publishedAt), {
                              addSuffix: true,
                            })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
