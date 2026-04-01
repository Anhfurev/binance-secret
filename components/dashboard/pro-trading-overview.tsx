"use client";

import { Activity, BookOpen, Fish, Shield, Target, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  AITradeSignal,
  CoinData,
  FuturesSignal,
  GrowthCandidate,
  PricePrediction,
  PortfolioSnapshot,
  WhaleTransaction,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/components/language-provider";

interface ProTradingOverviewProps {
  coins: CoinData[];
  aiSignals: AITradeSignal[];
  predictions: PricePrediction[];
  candidates: GrowthCandidate[];
  futuresSignals: FuturesSignal[];
  portfolio: PortfolioSnapshot;
  whales: WhaleTransaction[];
  whaleLoading?: boolean;
}

function formatUsd(value: number) {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function timeAgo(timestamp: Date) {
  const diff = Date.now() - timestamp.getTime();
  const min = Math.floor(diff / (1000 * 60));
  if (min < 60) return `${Math.max(0, min)}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ProTradingOverview({
  coins,
  aiSignals,
  predictions,
  candidates,
  futuresSignals,
  portfolio,
  whales,
  whaleLoading,
}: ProTradingOverviewProps) {
  const { t } = useLanguage();

  const majorCoins = coins.slice(0, 5);
  const activeSignals = futuresSignals.filter((signal) => signal.signal !== "WAIT");
  const primarySignal = activeSignals[0] ?? futuresSignals[0] ?? null;
  const topCandidate = candidates[0] ?? null;
  const topAsset = portfolio.assets[0];
  const whaleAlert = whales[0] ?? null;

  const marketMoodScore = majorCoins.length
    ? majorCoins.reduce(
        (acc, coin) => acc + (coin.price_change_percentage_24h ?? 0),
        0,
      ) / majorCoins.length
    : 0;

  const marketMood =
    marketMoodScore >= 1
      ? t("Positive", "Эерэг")
      : marketMoodScore <= -1
        ? t("Careful", "Болгоомжтой")
        : t("Neutral", "Тэнцвэртэй");

  const riskLabel =
    portfolio.riskScore >= 70
      ? t("High", "Өндөр")
      : portfolio.riskScore >= 40
        ? t("Medium", "Дунд")
        : t("Low", "Бага");

  return (
    <div className="mb-6 grid gap-6 lg:grid-cols-12">
      <Card className="border-border/60 bg-card/70 backdrop-blur-sm lg:col-span-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <BookOpen className="h-4 w-4 text-primary" />
            {t("Start Here", "Эндээс эхэл")}
            <Badge variant="outline" className="text-[10px]">
              {t("Simple", "Энгийн")}
            </Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t(
              "Read these 3 lines first before checking anything else.",
              "Өөр зүйл харахаасаа өмнө энэ 3 мөрийг түрүүлж унш.",
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
            <p className="text-[11px] text-muted-foreground">
              {t("1) Market mood", "1) Зах зээлийн төлөв")}
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {marketMood} ({marketMoodScore >= 0 ? "+" : ""}
              {marketMoodScore.toFixed(2)}%)
            </p>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
            <p className="text-[11px] text-muted-foreground">
              {t("2) Main signal", "2) Гол дохио")}
            </p>
            {primarySignal ? (
              <p className="mt-1 text-sm font-semibold text-foreground">
                {primarySignal.symbol} {primarySignal.signal} ({primarySignal.confidence}%)
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                {t("No signal yet", "Одоохондоо дохио алга")}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
            <p className="text-[11px] text-muted-foreground">
              {t("3) Risk level", "3) Эрсдэлийн түвшин")}
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {riskLabel} ({portfolio.riskScore}/100)
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/70 backdrop-blur-sm lg:col-span-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Activity className="h-4 w-4 text-primary" />
            {t("Only Needed Market Data", "Зөвхөн хэрэгтэй зах зээлийн дата")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t(
              "Focus on price and 24h change only.",
              "Зөвхөн үнэ болон 24ц өөрчлөлтийг хар.",
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {majorCoins.map((coin) => {
            const up = (coin.price_change_percentage_24h ?? 0) >= 0;
            return (
              <div
                key={coin.id}
                className="rounded-lg border border-border/50 bg-secondary/20 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    {coin.symbol.toUpperCase()}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {formatUsd(coin.current_price)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">24h</span>
                  <span className={up ? "text-success" : "text-destructive"}>
                    {up ? "+" : ""}
                    {coin.price_change_percentage_24h.toFixed(2)}%
                  </span>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/70 backdrop-blur-sm lg:col-span-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Shield className="h-4 w-4 text-primary" />
            {t("Simple Account Check", "Дансны энгийн шалгалт")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
              <p className="text-[11px] text-muted-foreground">
                {t("Balance", "Үлдэгдэл")}
              </p>
              <p className="text-base font-semibold text-foreground">
                {formatUsd(portfolio.totalBalance)}
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
              <p className="text-[11px] text-muted-foreground">
                {t("24h PnL", "24ц PnL")}
              </p>
              <p
                className={cn(
                  "text-base font-semibold",
                  portfolio.pnl24h >= 0 ? "text-success" : "text-destructive",
                )}
              >
                {portfolio.pnl24h >= 0 ? "+" : ""}
                {formatUsd(portfolio.pnl24h)}
              </p>
            </div>
          </div>
          {topAsset && (
            <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 text-xs text-muted-foreground">
              {t("Largest position", "Хамгийн том байрлал")}: {topAsset.symbol} (
              {topAsset.allocation.toFixed(1)}%)
            </div>
          )}
          {topCandidate && (
            <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">
                {t("Suggested focus", "Анхаарах санал")}
              </p>
              <p>
                {topCandidate.symbol} - {topCandidate.suggestedAction} ({topCandidate.confidence}%)
              </p>
            </div>
          )}
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 text-xs text-muted-foreground">
            {whaleLoading ? (
              <span>
                {t(
                  "Loading latest warning...",
                  "Сүүлийн анхааруулга ачааллаж байна...",
                )}
              </span>
            ) : whaleAlert ? (
              <span>
                {t("Latest whale move", "Сүүлийн whale хөдөлгөөн")}: {whaleAlert.symbol}{" "}
                {formatUsd(whaleAlert.valueUsd)} ({timeAgo(whaleAlert.timestamp)})
              </span>
            ) : (
              <span>
                {t(
                  "No major whale warning right now.",
                  "Одоогоор whale том анхааруулга алга.",
                )}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-primary/5 lg:col-span-12">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
          <p className="text-xs text-muted-foreground">
            {t(
              "If you feel confused, read in this order: Start Here -> Needed Market Data -> Simple Account Check.",
              "Хэрвээ эргэлзэж байвал дарааллаар нь унш: Эндээс эхэл -> Хэрэгтэй зах зээлийн дата -> Дансны энгийн шалгалт.",
            )}
          </p>
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 text-success">
              <TrendingUp className="h-3 w-3" /> {t("Up", "Өсөлт")}
            </span>
            <span className="inline-flex items-center gap-1 text-destructive">
              <Target className="h-3 w-3" /> {t("Signal", "Дохио")}
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Fish className="h-3 w-3" /> {t("Whale", "Whale")}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {t("AI models active", "AI идэвхтэй")} {aiSignals.length}/
            {predictions.length}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
