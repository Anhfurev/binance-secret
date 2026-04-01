"use client";

import { useState, useCallback } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { PortfolioSnapshotCard } from "@/components/dashboard/portfolio-snapshot";
import { MarketBoard } from "@/components/dashboard/market-board";
import { GrowthCandidates } from "@/components/dashboard/growth-candidates";
import { AlertFeed } from "@/components/dashboard/alert-feed";
import { NewsSentiment } from "@/components/dashboard/news-sentiment";
import { AiBriefing } from "@/components/dashboard/ai-briefing";
import { PremiumControlCenter } from "@/components/dashboard/premium-control-center";
import { StrategyPanel } from "@/components/dashboard/strategy-panel";
import { RiskControlsCard } from "@/components/dashboard/risk-controls";
import { ProTradingOverview } from "@/components/dashboard/pro-trading-overview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useMarketData,
  useGrowthCandidates,
  useSentimentData,
  useAlerts,
  useSignalsData,
  usePredictionsData,
  useBinanceAccountStatus,
  useFuturesSignals,
  useWhaleActivity,
} from "@/hooks/use-dashboard-data";
import { mockPortfolio } from "@/lib/mock-data";
import type {
  MarketStatus,
  PortfolioSnapshot,
  RiskControls,
} from "@/lib/types";
import { useLanguage } from "@/components/language-provider";
import { RefreshCw, Activity, TrendingUp, Clock, Zap } from "lucide-react";
import { toast } from "sonner";

export default function Dashboard() {
  // Data hooks
  const {
    coins,
    source: marketSource,
    lastUpdated,
    isLoading: marketLoading,
    refresh: refreshMarket,
  } = useMarketData();
  const {
    candidates,
    signalsChanged,
    isLoading: growthLoading,
    refresh: refreshGrowth,
  } = useGrowthCandidates();
  const {
    sentiment,
    news,
    isLoading: sentimentLoading,
    refresh: refreshSentiment,
  } = useSentimentData();
  const {
    alerts,
    isLoading: alertsLoading,
    refresh: refreshAlerts,
  } = useAlerts();
  const { signals: aiSignals } = useSignalsData();
  const { predictions } = usePredictionsData();
  const {
    configured: binanceConfigured,
    canTrade,
    canWithdraw,
    apiError: binanceApiError,
  } = useBinanceAccountStatus();
  const { signals: futuresSignals, generatedAt: futuresGeneratedAt } =
    useFuturesSignals();
  const { transactions: whaleTransactions, isLoading: whaleLoading } =
    useWhaleActivity();

  // Local state
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveAutoPilot, setLiveAutoPilot] = useState(false);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot>(mockPortfolio);
  const [riskControls, setRiskControls] = useState<RiskControls>({
    maxPositionSize: 20,
    maxDailyLoss: 5,
    stopLossReminder: true,
  });
  const { t } = useLanguage();

  // Calculate market status based on data
  const getMarketStatus = (): MarketStatus => {
    if (sentiment.fearGreedIndex >= 60) return "Risk-On";
    if (sentiment.fearGreedIndex <= 40) return "Risk-Off";
    return "Neutral";
  };

  // Refresh all data
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([
      refreshMarket(),
      refreshGrowth(),
      refreshSentiment(),
      refreshAlerts(),
    ]);
    setIsRefreshing(false);
  }, [refreshMarket, refreshGrowth, refreshSentiment, refreshAlerts]);

  // Toggle capital protection
  const handleCapitalProtectionToggle = (enabled: boolean) => {
    setPortfolio((prev) => ({ ...prev, capitalProtectionMode: enabled }));
  };

  const marketStatus = getMarketStatus();
  const topFuturesSignal = futuresSignals[0];

  const handleLiveAutoPilotChange = (enabled: boolean) => {
    if (enabled && (!binanceConfigured || !canTrade || canWithdraw)) {
      toast.error(
        t("Auto trade cannot be enabled yet", "Auto trade одоохондоо асахгүй"),
        {
          description: t(
            "Need Binance connected, trading ON, and withdrawal OFF.",
            "Binance холболт, trading ON, withdrawal OFF байх шаардлагатай.",
          ),
        },
      );
      return;
    }

    setLiveAutoPilot(enabled);
    toast.success(
      enabled
        ? t("Live Auto Trade enabled", "Live Auto Trade асаалаа")
        : t("Live Auto Trade disabled", "Live Auto Trade унтраалаа"),
      {
        description: enabled
          ? t(
              "System will prioritize top confidence setups.",
              "Систем өндөр итгэлцэлтэй setup-уудыг түлхүү сонгоно.",
            )
          : t(
              "You are now in manual-confirm mode.",
              "Одоо та гараар баталгаажуулах горимд байна.",
            ),
      },
    );
  };

  const marketStatusLabel =
    marketStatus === "Risk-On"
      ? t("Risk-On (Bullish)", "Risk-On (өсөх төлөв)")
      : marketStatus === "Risk-Off"
        ? t("Risk-Off (Bearish)", "Risk-Off (буурах төлөв)")
        : t("Neutral", "Төвийг сахисан");

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 md:px-6 lg:py-8">
        {/* Dashboard Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold text-foreground md:text-3xl">
              <Zap className="h-7 w-7 text-primary" />
              {t("Terminal", "Терминал")}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Badge
                variant={
                  marketStatus === "Risk-On"
                    ? "default"
                    : marketStatus === "Risk-Off"
                      ? "destructive"
                      : "secondary"
                }
              >
                <TrendingUp className="mr-1 h-3 w-3" />
                {marketStatusLabel}
              </Badge>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {t("Updated", "Шинэчлэгдсэн")}{" "}
                {lastUpdated?.toLocaleTimeString() ??
                  t("Loading...", "Уншиж байна...")}
              </span>
              <Badge variant="outline" className="text-[10px]">
                {marketSource === "live"
                  ? t("Live Data", "Шууд өгөгдөл")
                  : t("Cached", "Кэш")}
              </Badge>
              <Badge variant={binanceConfigured ? "default" : "secondary"}>
                {binanceConfigured
                  ? canTrade
                    ? t("Binance Trading ON", "Binance арилжаа ON")
                    : t("Binance Connected", "Binance холбогдсон")
                  : t("Binance Not Configured", "Binance тохируулаагүй")}
              </Badge>
              {binanceConfigured && canWithdraw && (
                <Badge variant="destructive" className="text-[10px]">
                  {t(
                    "Warning: Withdraw Enabled",
                    "Анхаар: Таталт идэвхтэй байна",
                  )}
                </Badge>
              )}
            </div>
          </div>
          <Button
            onClick={handleRefresh}
            disabled={isRefreshing}
            variant="outline"
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
            {t("Refresh", "Шинэчлэх")}
          </Button>
        </div>

        {(topFuturesSignal || binanceApiError) && (
          <div className="mb-6 rounded-lg border border-border/60 bg-card/70 p-4 backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge variant="outline" className="text-[10px]">
                {t("Futures AI", "Futures AI")}
              </Badge>
              {topFuturesSignal && (
                <>
                  <span className="font-medium text-foreground">
                    {topFuturesSignal.symbol} {topFuturesSignal.signal}
                  </span>
                  <span className="text-muted-foreground">
                    {t("Confidence", "Итгэлцэл")} {topFuturesSignal.confidence}%
                  </span>
                  <span className="text-muted-foreground">
                    {t("Funding", "Funding")}{" "}
                    {(topFuturesSignal.fundingRate * 100).toFixed(4)}%
                  </span>
                </>
              )}
              {futuresGeneratedAt && (
                <span className="text-xs text-muted-foreground">
                  {t("Updated", "Шинэчлэгдсэн")}{" "}
                  {futuresGeneratedAt.toLocaleTimeString()}
                </span>
              )}
              {binanceApiError && (
                <span className="text-xs text-destructive">
                  {t("Binance API error:", "Binance API алдаа:")}{" "}
                  {binanceApiError}
                </span>
              )}
            </div>
            {topFuturesSignal && (
              <p className="mt-2 text-xs text-muted-foreground">
                {topFuturesSignal.reason}
              </p>
            )}
          </div>
        )}

        <PremiumControlCenter
          binanceConfigured={binanceConfigured}
          canTrade={canTrade}
          canWithdraw={canWithdraw}
          autoPilotEnabled={liveAutoPilot}
          onAutoPilotChange={handleLiveAutoPilotChange}
          topSignal={topFuturesSignal}
        />

        <div className="mb-6">
          <AiBriefing
            coins={coins}
            candidates={candidates}
            sentiment={sentiment}
          />
        </div>

        <div className="mb-6">
          <StrategyPanel
            fearGreedIndex={sentiment.fearGreedIndex}
            btcChange24h={
              coins.find((c) => c.symbol === "btc")?.price_change_percentage_24h
            }
            aiSignals={aiSignals}
          />
        </div>

        <ProTradingOverview
          coins={coins}
          aiSignals={aiSignals}
          predictions={predictions}
          candidates={candidates}
          futuresSignals={futuresSignals}
          portfolio={portfolio}
          whales={whaleTransactions}
          whaleLoading={whaleLoading}
        />

        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left Column - Portfolio & Risk */}
          <div className="space-y-6 lg:col-span-3">
            <PortfolioSnapshotCard
              portfolio={portfolio}
              onCapitalProtectionToggle={handleCapitalProtectionToggle}
            />
            <RiskControlsCard
              controls={riskControls}
              onUpdate={setRiskControls}
            />
          </div>

          {/* Center Column - Market & Growth */}
          <div className="space-y-6 lg:col-span-6">
            <MarketBoard
              coins={coins}
              isLoading={marketLoading || isRefreshing}
            />
            <GrowthCandidates
              candidates={candidates}
              signalsChanged={signalsChanged}
              isLoading={growthLoading || isRefreshing}
            />
          </div>

          {/* Right Column - Alerts & News */}
          <div className="space-y-6 lg:col-span-3">
            <AlertFeed
              alerts={alerts}
              isLoading={alertsLoading || isRefreshing}
            />
          </div>
        </div>

        {/* News & Sentiment - Full Width */}
        <div className="mt-6">
          <NewsSentiment
            news={news}
            sentiment={sentiment}
            isLoading={sentimentLoading || isRefreshing}
          />
        </div>
      </div>
    </AppLayout>
  );
}
