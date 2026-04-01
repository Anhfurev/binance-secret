"use client";

import { useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChartLine,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  Target,
  Shield,
  AlertTriangle,
  RefreshCw,
  Zap,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useLanguage } from "@/components/language-provider";
import { usePredictionsData } from "@/hooks/use-dashboard-data";

export default function PredictionsPage() {
  const { t } = useLanguage();
  const tr = (en: string, mn: string) => t(en, mn);
  const [selectedCoin, setSelectedCoin] = useState("bitcoin");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => new Date());
  const { predictions, source, computed, refresh } = usePredictionsData();

  const formatTimeAgo = (date: Date) => {
    const diff = Math.max(0, Date.now() - date.getTime());
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return t("Just now", "Саяхан");
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
      return t(`Updated ${minutes}m ago`, `${minutes} минутын өмнө`);
    const hours = Math.floor(minutes / 60);
    return t(`Updated ${hours}h ago`, `${hours} цагийн өмнө`);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setLastUpdated(new Date());
    setIsRefreshing(false);
    toast.success(t("Predictions updated!", "Таамгалал шинэчлэгдлээ!"), {
      description: t(
        computed
          ? "Live AI predictions computed from market data."
          : "Using latest cached predictions.",
        computed
          ? "Захын өгөгдлөөс live AI таамгалал тооцоолов."
          : "Кэштэйгсэн таамгалал ашиглаж байна.",
      ),
    });
  };

  const formatPrice = (price: number) => {
    if (price >= 1000) return `$${price.toLocaleString()}`;
    if (price >= 1) return `$${price.toFixed(2)}`;
    return `$${price.toFixed(4)}`;
  };

  const selectedPrediction =
    predictions.find((p) => p.coinId === selectedCoin) ??
    predictions[0] ??
    null;

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 md:px-6 lg:py-8">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="flex items-center gap-3 text-2xl font-bold text-foreground md:text-3xl">
                <ChartLine className="h-7 w-7 text-primary" />
                {t("AI Price Predictions", "AI үнийн таамаглал")}
              </h1>
              <p className="mt-1 text-muted-foreground">
                {t(
                  "Machine learning powered price forecasts with confidence scores",
                  "Машин сургалт дээр суурилсан итгэлцлийн оноотой үнийн таамаглал",
                )}
              </p>
            </div>
            <Button onClick={handleRefresh} disabled={isRefreshing}>
              {isRefreshing ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-2 h-4 w-4" />
              )}
              {isRefreshing
                ? t("Updating...", "Шинэчилж байна...")
                : t("Refresh Models", "Загвар шинэчлэх")}
            </Button>
          </div>
        </div>

        {/* Coin Selector */}
        <div className="mb-6 flex flex-wrap gap-2">
          {predictions.map((pred) => (
            <Button
              key={pred.coinId}
              variant={selectedCoin === pred.coinId ? "default" : "outline"}
              onClick={() => setSelectedCoin(pred.coinId)}
              className="gap-2"
            >
              {pred.symbol}
              {pred.predictions[1].direction === "up" && (
                <TrendingUp className="h-4 w-4 text-success" />
              )}
              {pred.predictions[1].direction === "down" && (
                <TrendingDown className="h-4 w-4 text-destructive" />
              )}
            </Button>
          ))}
        </div>

        {/* Main Prediction Card */}
        {!selectedPrediction ? (
          <Card className="mb-8 border-border/50 bg-card/60 backdrop-blur-sm">
            <CardContent className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-3 text-center">
                <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                <p className="text-muted-foreground">
                  {t("Loading predictions...", "Таамаглал ачааллаж байна...")}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-8 border-border/50 bg-card/60 backdrop-blur-sm">
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-2xl">
                    {selectedPrediction.symbol} Price Predictions
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {t("Current Price", "Одоогийн үнэ")}:{" "}
                    <span className="font-mono font-bold text-foreground">
                      {formatPrice(selectedPrediction.currentPrice)}
                    </span>
                  </CardDescription>
                </div>
                <Badge variant="outline" className="px-3 py-1.5">
                  <Clock className="mr-1.5 h-4 w-4" />
                  {formatTimeAgo(lastUpdated)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {/* Timeframe Predictions */}
              <div className="grid gap-4 md:grid-cols-4">
                {selectedPrediction.predictions.map((pred) => (
                  <Card
                    key={pred.timeframe}
                    className={cn(
                      "border-border/50",
                      pred.direction === "up" && "bg-success/5",
                      pred.direction === "down" && "bg-destructive/5",
                      pred.direction === "sideways" && "bg-muted/50",
                    )}
                  >
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground uppercase">
                          {pred.timeframe}
                        </p>
                        {pred.direction === "up" && (
                          <ArrowUp className="h-5 w-5 text-success" />
                        )}
                        {pred.direction === "down" && (
                          <ArrowDown className="h-5 w-5 text-destructive" />
                        )}
                        {pred.direction === "sideways" && (
                          <Minus className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>

                      <p className="mt-2 font-mono text-xl font-bold text-foreground">
                        {formatPrice(pred.predictedPrice)}
                      </p>

                      <p
                        className={cn(
                          "mt-1 text-sm font-bold",
                          pred.percentChange >= 0
                            ? "text-success"
                            : "text-destructive",
                        )}
                      >
                        {pred.percentChange >= 0 ? "+" : ""}
                        {pred.percentChange.toFixed(2)}%
                      </p>

                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{t("Confidence", "Итгэлцэл")}</span>
                          <span className="font-bold">{pred.confidence}%</span>
                        </div>
                        <Progress
                          value={pred.confidence}
                          className="mt-1 h-1.5"
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Support & Resistance */}
              <div className="mt-6 grid gap-6 md:grid-cols-2">
                <div>
                  <h4 className="mb-3 flex items-center gap-2 font-semibold text-foreground">
                    <Shield className="h-4 w-4 text-success" />
                    {t("Support Levels", "Дэмжлэгийн түвшин")}
                  </h4>
                  <div className="space-y-2">
                    {selectedPrediction.supportLevels.map((level, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-lg bg-success/10 px-4 py-2"
                      >
                        <span className="text-sm text-muted-foreground">
                          S{idx + 1}
                        </span>
                        <span className="font-mono font-bold text-success">
                          {formatPrice(level)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {(
                            ((level - selectedPrediction.currentPrice) /
                              selectedPrediction.currentPrice) *
                            100
                          ).toFixed(1)}
                          %
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="mb-3 flex items-center gap-2 font-semibold text-foreground">
                    <Target className="h-4 w-4 text-destructive" />
                    {t("Resistance Levels", "Эсэргүүцлийн түвшин")}
                  </h4>
                  <div className="space-y-2">
                    {selectedPrediction.resistanceLevels.map((level, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-lg bg-destructive/10 px-4 py-2"
                      >
                        <span className="text-sm text-muted-foreground">
                          R{idx + 1}
                        </span>
                        <span className="font-mono font-bold text-destructive">
                          {formatPrice(level)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          +
                          {(
                            ((level - selectedPrediction.currentPrice) /
                              selectedPrediction.currentPrice) *
                            100
                          ).toFixed(1)}
                          %
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* AI Analysis */}
              <div className="mt-6 rounded-lg border border-primary/30 bg-primary/5 p-4">
                <h4 className="flex items-center gap-2 font-semibold text-foreground">
                  <Zap className="h-4 w-4 text-primary" />
                  {t("AI Analysis", "AI анализ")}
                </h4>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {tr(
                    selectedPrediction.aiAnalysis,
                    selectedPrediction.symbol === "BTC"
                      ? "BTC хуримтлалын хэв маяг харуулж байна. ETF урсгал эерэг хэвээр. $100K нь гол breakout түвшин."
                      : selectedPrediction.symbol === "ETH"
                        ? "ETH Dencun шинэчлэлтийн дараах нэгтгэлд байна. L2 ашиглалт өсөж байна."
                        : selectedPrediction.symbol === "SOL"
                          ? "SOL том coin-уудаас momentum хамгийн хүчтэй. DeFi TVL өсөлт сайн байна."
                          : "XRP богино хугацаанд дарамттай, урт хугацаа нь зохицуулалтын тодорхойгүй байдлаас хамаарна.",
                  )}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* All Predictions Overview */}
        <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ChartLine className="h-5 w-5 text-primary" />
              {t("24h Predictions Overview", "24ц таамаглалын тойм")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {predictions.map((pred) => {
                const pred24h = pred.predictions.find(
                  (p) => p.timeframe === "24h",
                )!;
                return (
                  <div
                    key={pred.coinId}
                    className={cn(
                      "flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between",
                      pred24h.direction === "up" &&
                        "border-success/30 bg-success/5",
                      pred24h.direction === "down" &&
                        "border-destructive/30 bg-destructive/5",
                      pred24h.direction === "sideways" && "border-border/50",
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={cn(
                          "flex h-12 w-12 items-center justify-center rounded-full",
                          pred24h.direction === "up" && "bg-success/20",
                          pred24h.direction === "down" && "bg-destructive/20",
                          pred24h.direction === "sideways" && "bg-muted",
                        )}
                      >
                        {pred24h.direction === "up" && (
                          <TrendingUp className="h-6 w-6 text-success" />
                        )}
                        {pred24h.direction === "down" && (
                          <TrendingDown className="h-6 w-6 text-destructive" />
                        )}
                        {pred24h.direction === "sideways" && (
                          <Minus className="h-6 w-6 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <p className="text-lg font-bold text-foreground">
                          {pred.symbol}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatPrice(pred.currentPrice)} →{" "}
                          {formatPrice(pred24h.predictedPrice)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">
                          {t("Change", "Өөрчлөлт")}
                        </p>
                        <p
                          className={cn(
                            "font-mono font-bold",
                            pred24h.percentChange >= 0
                              ? "text-success"
                              : "text-destructive",
                          )}
                        >
                          {pred24h.percentChange >= 0 ? "+" : ""}
                          {pred24h.percentChange.toFixed(2)}%
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">
                          {t("Confidence", "Итгэлцэл")}
                        </p>
                        <p className="font-bold text-foreground">
                          {pred24h.confidence}%
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedCoin(pred.coinId)}
                      >
                        {t("Details", "Дэлгэрэнгүй")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Disclaimer */}
        <Card className="mt-6 border-warning/30 bg-warning/5">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <div>
                <p className="font-medium text-foreground">
                  {t("Important Disclaimer", "Чухал анхааруулга")}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tr(
                    "AI predictions are based on historical data and technical analysis. Cryptocurrency markets are highly volatile and unpredictable. These predictions should not be considered financial advice. Always do your own research and never invest more than you can afford to lose.",
                    "AI таамаглал нь түүхэн өгөгдөл болон техник анализ дээр суурилдаг. Крипто зах маш савлагаатай, урьдчилан таамаглахад төвөгтэй. Эдгээрийг санхүүгийн зөвлөгөө гэж үзэхгүй. Заавал өөрийн судалгааг хийж, алдаж болох хэмжээнээс илүү хөрөнгө бүү оруул.",
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
