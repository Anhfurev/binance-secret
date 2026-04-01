"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  Target,
  Shield,
  ChevronDown,
  ChevronUp,
  Zap,
  AlertTriangle,
  CheckCircle2,
  Activity,
  BarChart2,
  Flame,
  ShoppingCart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AITradeSignal } from "@/lib/types";
import { useState } from "react";
import { useLanguage } from "@/components/language-provider";

interface SignalCardProps {
  signal: AITradeSignal;
  onTrade?: (signal: AITradeSignal, action: "execute" | "demo") => void;
  isBought?: boolean;
  recentAction?: "demo" | "execute" | null;
}

function getRiskLevel(signal: AITradeSignal): "Low" | "Medium" | "High" {
  if (signal.riskScore <= 35) return "Low";
  if (signal.riskScore <= 62) return "Medium";
  return "High";
}

function riskBadgeClass(risk: "Low" | "Medium" | "High") {
  if (risk === "Low") return "border-success/30 bg-success/10 text-success";
  if (risk === "Medium") return "border-warning/30 bg-warning/10 text-warning";
  return "border-destructive/30 bg-destructive/10 text-destructive";
}

const signalConfig = {
  STRONG_BUY: {
    label: "Strong Buy",
    color: "bg-success text-success-foreground",
    icon: TrendingUp,
    gradient: "from-success/20 to-transparent",
    iconColor: "text-success",
  },
  BUY: {
    label: "Buy",
    color: "bg-success/80 text-success-foreground",
    icon: TrendingUp,
    gradient: "from-success/10 to-transparent",
    iconColor: "text-success",
  },
  HOLD: {
    label: "Hold",
    color: "bg-muted text-muted-foreground",
    icon: Minus,
    gradient: "from-muted/20 to-transparent",
    iconColor: "text-muted-foreground",
  },
  SELL: {
    label: "Sell",
    color: "bg-destructive/80 text-destructive-foreground",
    icon: TrendingDown,
    gradient: "from-destructive/10 to-transparent",
    iconColor: "text-destructive",
  },
  STRONG_SELL: {
    label: "Strong Sell",
    color: "bg-destructive text-destructive-foreground",
    icon: TrendingDown,
    gradient: "from-destructive/20 to-transparent",
    iconColor: "text-destructive",
  },
};

const signalRingColor: Record<string, string> = {
  STRONG_BUY: "ring-success",
  BUY: "ring-success/60",
  HOLD: "ring-border/50",
  SELL: "ring-destructive/60",
  STRONG_SELL: "ring-destructive",
};

const signalBorderAccent: Record<string, string> = {
  STRONG_BUY: "border-l-success",
  BUY: "border-l-success/60",
  HOLD: "border-l-muted-foreground/30",
  SELL: "border-l-destructive/60",
  STRONG_SELL: "border-l-destructive",
};

const confidenceBarColor = (c: number) =>
  c >= 75 ? "bg-success" : c >= 55 ? "bg-warning" : "bg-destructive";

function getConfidenceStrength(confidence: number): {
  label: string;
  labelMn: string;
  bars: number;
  color: string;
} {
  if (confidence >= 85)
    return {
      label: "Very Strong",
      labelMn: "Маш хүчтэй",
      bars: 5,
      color: "text-success",
    };
  if (confidence >= 75)
    return {
      label: "Strong",
      labelMn: "Хүчтэй",
      bars: 4,
      color: "text-success",
    };
  if (confidence >= 65)
    return {
      label: "Moderate",
      labelMn: "Дунд зэрэг",
      bars: 3,
      color: "text-warning",
    };
  if (confidence >= 50)
    return { label: "Weak", labelMn: "Сул", bars: 2, color: "text-warning" };
  return {
    label: "Very Weak",
    labelMn: "Маш сул",
    bars: 1,
    color: "text-destructive",
  };
}

function getTrendStrength(signal: AITradeSignal): number {
  let score = 0;
  const isBullish = signal.signalType.includes("BUY");
  const isBearish = signal.signalType.includes("SELL");
  const { macd, movingAverages, volume, rsi } = signal.technicalIndicators;
  if (isBullish) {
    if (macd === "bullish") score += 1;
    if (movingAverages === "above") score += 1;
    if (volume === "high") score += 1;
    if (rsi >= 50 && rsi <= 70) score += 1;
    else if (rsi >= 40 && rsi < 50) score += 0.5;
    if (signal.signalType === "STRONG_BUY") score += 0.5;
  } else if (isBearish) {
    if (macd === "bearish") score += 1;
    if (movingAverages === "below") score += 1;
    if (volume === "high") score += 1;
    if (rsi >= 30 && rsi <= 50) score += 1;
    else if (rsi > 50 && rsi <= 60) score += 0.5;
    if (signal.signalType === "STRONG_SELL") score += 0.5;
  } else {
    score = 2;
  }
  return Math.min(5, Math.max(1, Math.round(score)));
}

export function SignalCard({
  signal,
  onTrade,
  isBought = false,
  recentAction = null,
}: SignalCardProps) {
  const { t } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(false);
  const config = signalConfig[signal.signalType];
  const SignalIcon = config.icon;
  const direction = signal.signalType.includes("BUY")
    ? "BUY"
    : signal.signalType.includes("SELL")
      ? "SELL"
      : "HOLD";
  const riskLevel = getRiskLevel(signal);
  const strength = getConfidenceStrength(signal.confidence);
  const trendBars = getTrendStrength(signal);

  const formatPrice = (price: number) => {
    if (price >= 1000) return `$${price.toLocaleString()}`;
    if (price >= 1) return `$${price.toFixed(2)}`;
    return `$${price.toFixed(4)}`;
  };

  const formatTimeAgo = (input: Date | string | number) => {
    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) return "--";

    const diff = Date.now() - date.getTime();
    if (diff < 0) return "0m ago";
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return `${Math.floor(diff / (1000 * 60))}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const stopLossPercent = (
    ((signal.stopLoss - signal.currentPrice) / signal.currentPrice) *
    100
  ).toFixed(1);
  const tp1Percent = (
    ((signal.takeProfits[0].price - signal.currentPrice) /
      signal.currentPrice) *
    100
  ).toFixed(1);
  const rangeLow = Math.min(signal.stopLoss, signal.currentPrice);
  const rangeHigh = Math.max(
    signal.currentPrice,
    signal.takeProfits[signal.takeProfits.length - 1]?.price ??
      signal.takeProfits[0].price,
  );

  const askAiToExplainSignal = () => {
    if (typeof window === "undefined") return;

    const prompt = `Explain signal ${signal.id} for ${signal.symbol} ${signal.signalType} in simple terms`;
    window.dispatchEvent(
      new CustomEvent("nextrade:chat-ask", {
        detail: {
          prompt,
        },
      }),
    );
  };

  return (
    <Card
      className={cn(
        "card-hover overflow-hidden border-l-4 border-border/50 bg-card/60 backdrop-blur-sm",
        signalBorderAccent[signal.signalType],
        isBought && "ring-2 ring-success/40",
        recentAction && "animate-pulse",
      )}
    >
      {/* Signal Header */}
      <CardHeader
        className={cn(
          "relative pb-3 pt-4",
          `bg-linear-to-r ${config.gradient}`,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <img
                src={signal.image}
                alt={signal.name}
                className={cn(
                  "h-12 w-12 rounded-full ring-2",
                  signalRingColor[signal.signalType],
                )}
              />
              <div
                className={cn(
                  "absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full",
                  config.color,
                )}
              >
                <SignalIcon className="h-3.5 w-3.5" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-foreground">
                  {signal.symbol}
                </h3>
                <Badge variant="outline" className="text-[10px]">
                  {signal.name}
                </Badge>
              </div>
              <p className="mt-0.5 font-mono text-xl font-bold text-foreground">
                {formatPrice(signal.currentPrice)}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              {isBought && (
                <Badge className="border-success/40 bg-success/15 text-success">
                  <ShoppingCart className="mr-1 h-3 w-3" />
                  {t("Bought", "Худалдаж авсан")}
                </Badge>
              )}
              <Badge
                variant="outline"
                className={cn("text-[10px]", riskBadgeClass(riskLevel))}
              >
                {t("Risk", "Эрсдэл")}: {riskLevel}
              </Badge>
              <Badge
                className={cn("px-3 py-1 text-sm font-bold", config.color)}
              >
                {t("Direction", "Чиглэл")}: {direction}
              </Badge>
            </div>
            {recentAction && (
              <Badge className="bg-primary/15 text-primary">
                {recentAction === "execute"
                  ? t("Just executed", "Дөнгөж гүйцэтгэгдсэн")
                  : t("Just added", "Дөнгөж нэмэгдсэн")}
              </Badge>
            )}
            <Badge variant="outline" className="px-3 py-1 text-sm font-bold">
              {t(
                config.label,
                config.label === "Strong Buy"
                  ? "Хүчтэй авах"
                  : config.label === "Buy"
                    ? "Авах"
                    : config.label === "Hold"
                      ? "Хүлээх"
                      : config.label === "Sell"
                        ? "Зарах"
                        : "Хүчтэй зарах",
              )}
            </Badge>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatTimeAgo(signal.createdAt)}
            </div>
          </div>
        </div>

        {/* Confidence + Trend Strength */}
        <div className="mt-4 space-y-3">
          {/* Confidence Bar */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-primary" />
                <span className="text-muted-foreground">
                  {t("AI Confidence", "AI итгэлцэл")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-wide",
                    strength.color,
                  )}
                >
                  {t(strength.label, strength.labelMn)}
                </span>
                <span className="font-bold text-foreground">
                  {signal.confidence}%
                </span>
              </div>
            </div>
            {/* Color-coded gradient bar */}
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  confidenceBarColor(signal.confidence),
                )}
                style={{ width: `${signal.confidence}%` }}
              />
            </div>
          </div>

          {/* Trend Strength Meter */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <Flame className="h-3.5 w-3.5 text-primary" />
                <span className="text-muted-foreground">
                  {t("Trend Strength", "Трендийн хүч")}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {trendBars}/5
              </span>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-2 flex-1 rounded-sm transition-all",
                    i < trendBars
                      ? signal.signalType.includes("BUY")
                        ? "bg-success"
                        : signal.signalType.includes("SELL")
                          ? "bg-destructive"
                          : "bg-muted-foreground"
                      : "bg-secondary",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg bg-secondary/50 p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("Entry", "Оролт")}
            </p>
            <p className="mt-1 font-mono text-sm font-bold text-foreground">
              {formatPrice(signal.entryPrice)}
            </p>
          </div>
          <div className="rounded-lg bg-destructive/10 p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("Stop-Loss Suggestion", "Stop-loss санал")}
            </p>
            <p className="mt-1 font-mono text-sm font-bold text-destructive">
              {formatPrice(signal.stopLoss)}
            </p>
            <p className="text-[10px] text-destructive">{stopLossPercent}%</p>
          </div>
          <div className="rounded-lg bg-success/10 p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("Take-Profit Suggestion", "Take-profit санал")}
            </p>
            <p className="mt-1 font-mono text-sm font-bold text-success">
              {formatPrice(signal.takeProfits[0].price)}
            </p>
            <p className="text-[10px] text-success">+{tp1Percent}%</p>
          </div>
          <div className="rounded-lg bg-info/10 p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("Expected Range", "Хүлээгдэж буй хүрээ")}
            </p>
            <p className="mt-1 font-mono text-xs font-bold text-info">
              {formatPrice(rangeLow)} - {formatPrice(rangeHigh)}
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("Risk Score", "Эрсдэлийн оноо")}
            </p>
            <p className="mt-1 text-sm font-bold text-foreground">
              {signal.riskScore}/100
            </p>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("Volatility", "Хэлбэлзэл")}
            </p>
            <p className="mt-1 text-sm font-bold capitalize text-foreground">
              {signal.volatilityLevel}
            </p>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("Expected Drawdown", "Хүлээгдэх drawdown")}
            </p>
            <p className="mt-1 text-sm font-bold text-destructive">
              -{signal.expectedDrawdown.toFixed(2)}%
            </p>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("Success Probability", "Амжилтын магадлал")}
            </p>
            <p className="mt-1 text-sm font-bold text-success">
              {signal.probabilityOfSuccess}%
            </p>
          </div>
        </div>

        {/* Risk/Reward */}
        <div className="mt-4 flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 p-3">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <span className="text-sm text-muted-foreground">
              {t("Risk/Reward", "Эрсдэл/Ашиг")}
            </span>
          </div>
          <Badge variant="outline" className="font-mono font-bold">
            1:{signal.riskRewardRatio}
          </Badge>
        </div>

        {/* Expand/Collapse */}
        <Button
          variant="ghost"
          className="mt-3 w-full justify-between text-muted-foreground hover:text-foreground"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <span className="text-sm">
            {isExpanded
              ? t("Hide Details", "Дэлгэрэнгүйг нуух")
              : t("Show Analysis", "Анализ харах")}
          </span>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="mt-4 space-y-4 border-t border-border/50 pt-4">
            {/* AI Reasoning */}
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Zap className="h-4 w-4 text-primary" />
                {t("AI Analysis", "AI анализ")}
              </h4>
              <ul className="space-y-2">
                {signal.reasoning.map((reason, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    {reason}
                  </li>
                ))}
              </ul>
            </div>

            {/* Technical Indicators */}
            <div>
              <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Shield className="h-4 w-4 text-info" />
                {t("Technical Indicators", "Техник үзүүлэлт")}
              </h4>

              {/* RSI Visual Gauge */}
              <div className="mb-3 rounded-lg bg-secondary/50 px-3 py-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    RSI-14
                  </p>
                  <span
                    className={cn(
                      "text-xs font-bold",
                      signal.technicalIndicators.rsi < 30
                        ? "text-success"
                        : signal.technicalIndicators.rsi > 70
                          ? "text-destructive"
                          : "text-foreground",
                    )}
                  >
                    {signal.technicalIndicators.rsi}
                    {signal.technicalIndicators.rsi < 30
                      ? " — Oversold"
                      : signal.technicalIndicators.rsi > 70
                        ? " — Overbought"
                        : " — Neutral"}
                  </span>
                </div>
                {/* RSI zone bar: 3 segments */}
                <div className="relative h-2 overflow-hidden rounded-full">
                  <div className="absolute inset-0 flex">
                    <div className="w-[30%] bg-success/30" />
                    <div className="w-[40%] bg-muted" />
                    <div className="w-[30%] bg-destructive/30" />
                  </div>
                  {/* Pointer */}
                  <div
                    className="absolute top-0 h-full w-1 rounded-full bg-foreground shadow"
                    style={{
                      left: `${Math.min(98, Math.max(1, signal.technicalIndicators.rsi))}%`,
                      transform: "translateX(-50%)",
                    }}
                  />
                </div>
                <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground">
                  <span>0 Oversold</span>
                  <span>50</span>
                  <span>100 Overbought</span>
                </div>
              </div>

              {/* MACD / MA / Volume colored badges */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-secondary/50 px-2 py-2 text-center">
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    MACD
                  </p>
                  <Badge
                    className={cn(
                      "text-[10px]",
                      signal.technicalIndicators.macd === "bullish" &&
                        "bg-success/20 text-success",
                      signal.technicalIndicators.macd === "bearish" &&
                        "bg-destructive/20 text-destructive",
                      signal.technicalIndicators.macd === "neutral" &&
                        "bg-muted text-muted-foreground",
                    )}
                  >
                    {signal.technicalIndicators.macd === "bullish" && (
                      <TrendingUp className="mr-1 h-2.5 w-2.5" />
                    )}
                    {signal.technicalIndicators.macd === "bearish" && (
                      <TrendingDown className="mr-1 h-2.5 w-2.5" />
                    )}
                    {signal.technicalIndicators.macd === "neutral" && (
                      <Minus className="mr-1 h-2.5 w-2.5" />
                    )}
                    {signal.technicalIndicators.macd}
                  </Badge>
                </div>
                <div className="rounded-lg bg-secondary/50 px-2 py-2 text-center">
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t("MA", "МА")}
                  </p>
                  <Badge
                    className={cn(
                      "text-[10px]",
                      signal.technicalIndicators.movingAverages === "above" &&
                        "bg-success/20 text-success",
                      signal.technicalIndicators.movingAverages === "below" &&
                        "bg-destructive/20 text-destructive",
                      signal.technicalIndicators.movingAverages ===
                        "crossing" && "bg-warning/20 text-warning",
                    )}
                  >
                    <BarChart2 className="mr-1 h-2.5 w-2.5" />
                    {signal.technicalIndicators.movingAverages}
                  </Badge>
                </div>
                <div className="rounded-lg bg-secondary/50 px-2 py-2 text-center">
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    Vol
                  </p>
                  <Badge
                    className={cn(
                      "text-[10px]",
                      signal.technicalIndicators.volume === "high" &&
                        "bg-info/20 text-info",
                      signal.technicalIndicators.volume === "normal" &&
                        "bg-muted text-muted-foreground",
                      signal.technicalIndicators.volume === "low" &&
                        "bg-warning/20 text-warning",
                    )}
                  >
                    <Activity className="mr-1 h-2.5 w-2.5" />
                    {signal.technicalIndicators.volume}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Take Profits */}
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Target className="h-4 w-4 text-success" />
                {t("Price Targets", "Үнийн зорилтууд")}
              </h4>
              <div className="space-y-2">
                {signal.takeProfits.map((tp, idx) => (
                  <div key={idx} className="rounded bg-success/5 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          TP{idx + 1}
                        </Badge>
                        <span className="font-mono text-sm font-bold text-success">
                          {formatPrice(tp.price)}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">
                          {tp.timeframe}
                        </p>
                        <p className="text-xs font-semibold text-success">
                          {tp.probability}% {t("prob", "магад")}
                        </p>
                      </div>
                    </div>
                    {/* Probability bar */}
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-success/70 transition-all"
                        style={{ width: `${tp.probability}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Market Conditions */}
            <div className="flex flex-wrap gap-2">
              {signal.marketConditions.map((condition, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs">
                  {condition}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-4 flex gap-2">
          <Button
            className="flex-1"
            variant="outline"
            onClick={() => onTrade?.(signal, "demo")}
          >
            {t("Quick Demo Buy", "Демо дээр хурдан авах")}
          </Button>
          <Button
            className={cn(
              "flex-1",
              (signal.signalType === "STRONG_BUY" ||
                signal.signalType === "BUY") &&
                "bg-success hover:bg-success/90 text-success-foreground",
              (signal.signalType === "STRONG_SELL" ||
                signal.signalType === "SELL") &&
                "bg-destructive hover:bg-destructive/90",
            )}
            onClick={() => onTrade?.(signal, "execute")}
          >
            {signal.signalType.includes("BUY")
              ? t("Execute Buy (Paper)", "BUY гүйцэтгэх (Paper)")
              : signal.signalType.includes("SELL")
                ? t("Execute Sell (Paper)", "SELL гүйцэтгэх (Paper)")
                : t("View Trade", "Арилжаа харах")}
          </Button>
        </div>

        <Button
          className="mt-2 w-full"
          variant="ghost"
          onClick={askAiToExplainSignal}
        >
          {t("Ask AI to Explain This Signal", "AI-аас энэ дохиог тайлбарлуул")}
        </Button>

        {/* Disclaimer */}
        <p className="mt-3 flex items-start gap-1 text-[10px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {t(
            "Not financial advice. AI predictions carry risk. Always DYOR.",
            "Санхүүгийн зөвлөгөө биш. AI таамаг эрсдэлтэй. Өөрийн судалгааг хий.",
          )}
        </p>
      </CardContent>
    </Card>
  );
}
