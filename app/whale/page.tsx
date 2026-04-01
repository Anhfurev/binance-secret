"use client";

import { useState } from "react";
import useSWR from "swr";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Fish,
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeftRight,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Bell,
  AlertTriangle,
  ExternalLink,
  Filter,
  BarChart2,
  Zap,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WhaleTransaction } from "@/lib/types";
import { toast } from "sonner";
import { useLanguage } from "@/components/language-provider";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function WhalePage() {
  const { t } = useLanguage();
  const tr = (en: string, mn: string) => t(en, mn);
  const [filter, setFilter] = useState<"all" | "bullish" | "bearish">("all");

  const { data, isLoading, isValidating, mutate } = useSWR<{
    transactions: (Omit<WhaleTransaction, "timestamp"> & {
      timestamp: string;
    })[];
    generatedAt: string;
  }>("/api/whale", fetcher, { refreshInterval: 60000 });

  const transactions: WhaleTransaction[] = (data?.transactions ?? []).map(
    (tx) => ({ ...tx, timestamp: new Date(tx.timestamp) }),
  );

  const filteredTransactions = transactions.filter((tx) => {
    if (filter === "all") return true;
    return tx.impact === filter;
  });

  const handleRefresh = () => {
    mutate();
    toast.success(t("Whale data refreshed!", "Whale өгөгдөл шинэчлэгдлээ!"));
  };

  const formatValue = (value: number) => {
    if (value >= 1000000000) return `$${(value / 1000000000).toFixed(2)}B`;
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    return `$${value.toLocaleString()}`;
  };

  const formatTimeAgo = (input: Date | string | number) => {
    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) return "--";

    const diff = Date.now() - date.getTime();
    if (diff < 0) return "0m ago";
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const bullishCount = transactions.filter(
    (t) => t.impact === "bullish",
  ).length;
  const bearishCount = transactions.filter(
    (t) => t.impact === "bearish",
  ).length;
  const totalVolume = transactions.reduce((sum, t) => sum + t.valueUsd, 0);
  const alertTransactions = transactions.filter(
    (tx) => tx.valueUsd >= 50_000_000,
  );

  const shortenAddress = (address: string) => {
    if (address.length <= 16) return address;
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  };

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 md:px-6 lg:py-8">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="flex items-center gap-3 text-2xl font-bold text-foreground md:text-3xl">
                <Fish className="h-7 w-7 text-primary" />
                {t("Whale Tracker", "Whale хяналт")}
              </h1>
              <p className="mt-1 text-muted-foreground">
                {t(
                  "Monitor large crypto transactions and whale activity",
                  "Том крипто гүйлгээ болон whale идэвхийг хянах",
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  toast.info(
                    t("Whale alerts enabled", "Whale мэдэгдэл идэвхжлээ"),
                  )
                }
              >
                <Bell className="mr-2 h-4 w-4" />
                {t("Set Alerts", "Анхааруулга тохируулах")}
              </Button>
              <Button size="sm" onClick={handleRefresh} disabled={isValidating}>
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${isValidating ? "animate-spin" : ""}`}
                />
                {t("Refresh", "Шинэчлэх")}
              </Button>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="mb-8 grid gap-4 md:grid-cols-5">
          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("24h Volume", "24ц хэмжээ")}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-foreground">
                    {formatValue(totalVolume)}
                  </p>
                </div>
                <div className="rounded-lg bg-primary/20 p-3">
                  <Fish className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("Transactions", "Гүйлгээ")}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-foreground">
                    {transactions.length}
                  </p>
                </div>
                <div className="rounded-lg bg-info/20 p-3">
                  <ArrowLeftRight className="h-5 w-5 text-info" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("Bullish Signals", "Өсөх дохио")}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-success">
                    {bullishCount}
                  </p>
                </div>
                <div className="rounded-lg bg-success/20 p-3">
                  <TrendingUp className="h-5 w-5 text-success" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("Bearish Signals", "Буурах дохио")}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-destructive">
                    {bearishCount}
                  </p>
                </div>
                <div className="rounded-lg bg-destructive/20 p-3">
                  <TrendingDown className="h-5 w-5 text-destructive" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("Net Flow Bias", "Урсгалын хандлага")}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-2xl font-bold",
                      bullishCount > bearishCount
                        ? "text-success"
                        : bearishCount > bullishCount
                          ? "text-destructive"
                          : "text-muted-foreground",
                    )}
                  >
                    {bullishCount > bearishCount
                      ? t("Outflow", "Гаралт")
                      : bearishCount > bullishCount
                        ? t("Inflow", "Оролт")
                        : t("Neutral", "Саармаг")}
                  </p>
                </div>
                <div
                  className={cn(
                    "rounded-lg p-3",
                    bullishCount > bearishCount
                      ? "bg-success/20"
                      : bearishCount > bullishCount
                        ? "bg-destructive/20"
                        : "bg-muted/20",
                  )}
                >
                  <BarChart2
                    className={cn(
                      "h-5 w-5",
                      bullishCount > bearishCount
                        ? "text-success"
                        : bearishCount > bullishCount
                          ? "text-destructive"
                          : "text-muted-foreground",
                    )}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filter Tabs */}
        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as typeof filter)}
          className="mb-6"
        >
          <TabsList className="bg-secondary/50">
            <TabsTrigger value="all">
              {t("All", "Бүгд")} ({transactions.length})
            </TabsTrigger>
            <TabsTrigger
              value="bullish"
              className="data-[state=active]:bg-success data-[state=active]:text-success-foreground"
            >
              {t("Bullish", "Өсөх")} ({bullishCount})
            </TabsTrigger>
            <TabsTrigger
              value="bearish"
              className="data-[state=active]:bg-destructive data-[state=active]:text-white"
            >
              {t("Bearish", "Буурах")} ({bearishCount})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <Card className="border-warning/30 bg-warning/10 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-warning" />
                {t("Large Movement Alerts", "Том хөдөлгөөний дохио")}
              </CardTitle>
              <CardDescription>
                {t(
                  "Alerts trigger when a transfer exceeds $50M in tracked assets.",
                  "$50M-оос давсан tracked asset хөдөлгөөнд дохио гарна.",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {alertTransactions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("No large alerts right now.", "Одоогоор том дохио алга.")}
                </p>
              ) : (
                alertTransactions.slice(0, 3).map((tx) => (
                  <div
                    key={`alert-${tx.id}`}
                    className="rounded-lg border border-border/50 bg-card/70 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-foreground">
                          {tx.symbol} {formatValue(tx.valueUsd)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {tx.from} {"->"} {tx.to}
                        </p>
                      </div>
                      <Badge
                        className={cn(
                          "text-xs",
                          tx.impact === "bullish" &&
                            "bg-success/20 text-success",
                          tx.impact === "bearish" &&
                            "bg-destructive/20 text-destructive",
                          tx.impact === "neutral" &&
                            "bg-muted text-muted-foreground",
                        )}
                      >
                        {t("Impact", "Нөлөө")}: {tx.impact}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Filter className="h-4 w-4 text-primary" />
                {t(
                  "Analysis breakdown per transaction",
                  "Гүйлгээ тус бүрийн шинжилгээ",
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm text-muted-foreground">
              <div className="flex items-start gap-2">
                <ArrowLeftRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <p>
                  {t(
                    "Exchange Flow — inflow/outflow classification with directional context",
                    "Exchange Flow — оролт/гаралтын ангилал ба чиглэлийн тайлбар",
                  )}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <p>
                  {t(
                    "Wallet Pattern — accumulation, distribution, OTC, or internal move with confidence score",
                    "Wallet хэв маяг — хуримтлал, тараалт, OTC эсвэл дотоод шилжүүлэг, итгэлцлийн хувьтай",
                  )}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <p>
                  {t(
                    "Market Impact — estimated price effect, magnitude, and timeframe",
                    "Захын нөлөө — үнийн нөлөөллийн тооцоо, хэмжээ, цаг хугацаа",
                  )}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Whale Transactions */}
        <div className="space-y-4">
          {isLoading ? (
            <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
              <CardContent className="flex items-center justify-center py-16">
                <RefreshCw className="mr-2 h-5 w-5 animate-spin text-primary" />
                <span className="text-muted-foreground">
                  {t(
                    "Loading whale data...",
                    "Whale мэдээлэл ачааллаж байна...",
                  )}
                </span>
              </CardContent>
            </Card>
          ) : filteredTransactions.length === 0 ? (
            <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
              <CardContent className="py-16 text-center text-muted-foreground">
                {t("No whale transactions found", "Whale гүйлгээ олдсонгүй")}
              </CardContent>
            </Card>
          ) : (
            filteredTransactions.map((tx) => (
              <Card
                key={tx.id}
                className="card-hover border-border/50 bg-card/60 backdrop-blur-sm"
              >
                <CardContent className="py-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-start gap-4">
                      {/* Transaction Type Icon */}
                      <div
                        className={cn(
                          "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
                          tx.type === "exchange_outflow" && "bg-success/20",
                          tx.type === "exchange_inflow" && "bg-destructive/20",
                          tx.type === "transfer" && "bg-info/20",
                        )}
                      >
                        {tx.type === "exchange_outflow" && (
                          <ArrowUpRight className="h-6 w-6 text-success" />
                        )}
                        {tx.type === "exchange_inflow" && (
                          <ArrowDownRight className="h-6 w-6 text-destructive" />
                        )}
                        {tx.type === "transfer" && (
                          <ArrowLeftRight className="h-6 w-6 text-info" />
                        )}
                      </div>

                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-lg font-bold text-foreground">
                            {tx.symbol}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-xs capitalize"
                          >
                            {tx.type.replace("_", " ")}
                          </Badge>
                          <Badge
                            className={cn(
                              "text-xs",
                              tx.impact === "bullish" &&
                                "bg-success/20 text-success",
                              tx.impact === "bearish" &&
                                "bg-destructive/20 text-destructive",
                              tx.impact === "neutral" &&
                                "bg-muted text-muted-foreground",
                            )}
                          >
                            {tx.impact === "bullish" && (
                              <TrendingUp className="mr-1 h-3 w-3" />
                            )}
                            {tx.impact === "bearish" && (
                              <TrendingDown className="mr-1 h-3 w-3" />
                            )}
                            {tx.impact === "neutral" && (
                              <Minus className="mr-1 h-3 w-3" />
                            )}
                            {tx.impact}
                          </Badge>
                        </div>

                        <p className="mt-1 font-mono text-xl font-bold text-foreground">
                          {tx.amount.toLocaleString()} {tx.symbol}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t("Value", "Үнэ цэнэ")}: {formatValue(tx.valueUsd)}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-[10px]">
                            {t("Asset", "Хөрөнгө")}: {tx.assetName}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="text-[10px] capitalize"
                          >
                            {t("Type", "Төрөл")}: {tx.assetType}
                          </Badge>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="rounded bg-secondary/50 px-2 py-0.5">
                            {tx.from}
                          </span>
                          <ArrowLeftRight className="h-3 w-3" />
                          <span className="rounded bg-secondary/50 px-2 py-0.5">
                            {tx.to}
                          </span>
                        </div>
                        <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                          <div className="rounded bg-secondary/30 px-2 py-1">
                            <span className="font-medium text-foreground">
                              {t("From wallet", "Эх wallet")}:
                            </span>
                            {shortenAddress(tx.fromAddress)}
                          </div>
                          <div className="rounded bg-secondary/30 px-2 py-1">
                            <span className="font-medium text-foreground">
                              {t("To wallet", "Очих wallet")}:
                            </span>
                            {shortenAddress(tx.toAddress)}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 md:flex-col md:items-end">
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        {formatTimeAgo(tx.timestamp)}
                      </div>
                      <Button variant="ghost" size="sm">
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* AI Analysis */}
                  <div className="mt-4 rounded-lg bg-secondary/30 p-3">
                    <p className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Fish className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {tr(
                        tx.aiAnalysis,
                        tx.impact === "bullish"
                          ? "Exchange-ээс их хэмжээний гарц ажиглагдав. Энэ нь хуримтлалын шинж тул богино хугацаанд өсөх дохио байж болно."
                          : tx.impact === "bearish"
                            ? "Exchange рүү их хэмжээний оролт орж байна. Ойрын хугацаанд зарах дарамт нэмэгдэх магадлалтай."
                            : "Том wallet хоорондын шилжүүлэг байна. Шууд захын нөлөө нь ихэвчлэн саармаг.",
                      )}
                    </p>
                  </div>

                  {/* Analysis Panels */}
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {/* Exchange Flow Panel */}
                    {tx.exchangeFlowAnalysis && (
                      <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                        <div className="mb-2 flex items-center gap-1.5">
                          <ArrowLeftRight className="h-3.5 w-3.5 text-primary" />
                          <span className="text-xs font-semibold text-foreground">
                            {t("Exchange Flow", "Exchange урсгал")}
                          </span>
                        </div>
                        <Badge
                          className={cn(
                            "mb-2 text-[10px]",
                            (tx.exchangeFlowAnalysis.classification ===
                              "strong_accumulation" ||
                              tx.exchangeFlowAnalysis.classification ===
                                "accumulation") &&
                              "bg-success/20 text-success",
                            (tx.exchangeFlowAnalysis.classification ===
                              "strong_distribution" ||
                              tx.exchangeFlowAnalysis.classification ===
                                "distribution") &&
                              "bg-destructive/20 text-destructive",
                            tx.exchangeFlowAnalysis.classification ===
                              "neutral_flow" &&
                              "bg-muted text-muted-foreground",
                          )}
                        >
                          {tx.exchangeFlowAnalysis.classification
                            .replace(/_/g, " ")
                            .replace(/\b\w/g, (c) => c.toUpperCase())}
                        </Badge>
                        <p className="text-[11px] font-medium text-foreground">
                          {tx.exchangeFlowAnalysis.netDirectionLabel}
                        </p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                          {tx.exchangeFlowAnalysis.contextNote}
                        </p>
                      </div>
                    )}

                    {/* Wallet Accumulation Pattern Panel */}
                    {tx.accumulationPattern && (
                      <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                        <div className="mb-2 flex items-center gap-1.5">
                          <Wallet className="h-3.5 w-3.5 text-primary" />
                          <span className="text-xs font-semibold text-foreground">
                            {t("Wallet Pattern", "Wallet хэв маяг")}
                          </span>
                        </div>
                        <Badge
                          variant="outline"
                          className="mb-2 text-[10px] capitalize"
                        >
                          {tx.accumulationPattern.patternType.replace(
                            /_/g,
                            " ",
                          )}
                        </Badge>
                        <div className="mb-1.5 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                tx.accumulationPattern.confidence >= 80
                                  ? "bg-success"
                                  : tx.accumulationPattern.confidence >= 60
                                    ? "bg-warning"
                                    : "bg-muted-foreground",
                              )}
                              style={{
                                width: `${tx.accumulationPattern.confidence}%`,
                              }}
                            />
                          </div>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {tx.accumulationPattern.confidence}%{" "}
                            {t("confidence", "итгэлцэл")}
                          </span>
                        </div>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {tx.accumulationPattern.description}
                        </p>
                      </div>
                    )}

                    {/* Market Impact Panel */}
                    {tx.marketImpactEstimate && (
                      <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                        <div className="mb-2 flex items-center gap-1.5">
                          <Zap className="h-3.5 w-3.5 text-primary" />
                          <span className="text-xs font-semibold text-foreground">
                            {t("Market Impact", "Захын нөлөө")}
                          </span>
                        </div>
                        <div className="mb-2 flex flex-wrap items-center gap-1">
                          <Badge
                            className={cn(
                              "text-[10px]",
                              (tx.marketImpactEstimate.priceEffect ===
                                "strong_bullish" ||
                                tx.marketImpactEstimate.priceEffect ===
                                  "bullish") &&
                                "bg-success/20 text-success",
                              tx.marketImpactEstimate.priceEffect ===
                                "neutral" && "bg-muted text-muted-foreground",
                              (tx.marketImpactEstimate.priceEffect ===
                                "strong_bearish" ||
                                tx.marketImpactEstimate.priceEffect ===
                                  "bearish") &&
                                "bg-destructive/20 text-destructive",
                            )}
                          >
                            {tx.marketImpactEstimate.priceEffect
                              .replace(/_/g, " ")
                              .replace(/\b\w/g, (c) => c.toUpperCase())}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {t("Magnitude", "Хэмжээ")}:{" "}
                            {tx.marketImpactEstimate.magnitude}
                          </Badge>
                        </div>
                        <p className="text-[11px] font-medium text-foreground">
                          ⏱ {tx.marketImpactEstimate.timeframe}
                        </p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                          {tx.marketImpactEstimate.note}
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* How It Works */}
        <Card className="mt-8 border-border/50 bg-card/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5 text-warning" />
              {t("Understanding Whale Activity", "Whale идэвхийг ойлгох")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-3">
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/20">
                  <ArrowUpRight className="h-4 w-4 text-success" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground">
                    {t("Exchange Outflow", "Exchange-ээс гаралт")}
                  </h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t(
                      "Coins leaving exchanges suggest accumulation and reduced selling pressure. Generally bullish.",
                      "Coin exchange-ээс гарч байвал хуримтлал нэмэгдэж, зарах дарамт буурч буйг илтгэнэ. Ихэнхдээ өсөх дохио.",
                    )}
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/20">
                  <ArrowDownRight className="h-4 w-4 text-destructive" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground">
                    {t("Exchange Inflow", "Exchange руу оролт")}
                  </h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t(
                      "Coins entering exchanges may indicate intent to sell. Watch for potential price drops.",
                      "Coin exchange рүү орвол зарах хүсэл нэмэгдэж болох тул үнэ буурах эрсдэлийг ажигла.",
                    )}
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-info/20">
                  <ArrowLeftRight className="h-4 w-4 text-info" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground">
                    {t("Wallet Transfer", "Wallet хооронд шилжүүлэг")}
                  </h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t(
                      "Large transfers between wallets may be OTC deals, internal moves, or strategic positioning.",
                      "Wallet хоорондын том шилжүүлэг нь OTC хэлцэл, дотоод хөдөлгөөн эсвэл стратегийн байршуулалт байж болно.",
                    )}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
