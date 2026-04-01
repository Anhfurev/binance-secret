"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Brain,
  Gauge,
  Save,
  Shield,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/lib/utils";
import type { AITradeSignal } from "@/lib/types";
import {
  ACTIVE_CUSTOM_STRATEGY_ID_KEY,
  STRATEGY_BUILDER_STORAGE_KEY,
  setActiveCustomStrategyId,
  type CustomStrategyConfig,
  type SavedCustomStrategy,
} from "@/lib/trading/custom-strategy";

type StrategyType = "trend" | "reversal" | "breakout" | "scalp";
type StrategySignal = "long" | "short" | "wait";
type RiskBand = "low" | "medium" | "high";
type MarketRegime = "bull" | "bear" | "range";
type RiskProfile = CustomStrategyConfig["riskProfile"];
type StopLossMode = CustomStrategyConfig["stopLossMode"];

interface Strategy {
  id: string;
  name: string;
  nameMn: string;
  type: StrategyType;
  signal: StrategySignal;
  winRate: number;
  riskReward: string;
  description: string;
  descriptionMn: string;
  pairs: string[];
  confidence: number;
  riskBand: RiskBand;
  timeframe: string;
  timeframeMn: string;
  positionSizePct: number;
  stopLossPct: number;
  rationale: string[];
  rationaleMn: string[];
  invalidation: string;
  invalidationMn: string;
  score: number;
}

interface StrategyPanelProps {
  fearGreedIndex: number;
  btcChange24h?: number;
  aiSignals?: AITradeSignal[];
}

type BuilderConfig = CustomStrategyConfig;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseRiskReward(rr: string) {
  const parts = rr.split(":");
  if (parts.length !== 2) return 1;
  const denominator = Number(parts[1]);
  return Number.isFinite(denominator) ? denominator : 1;
}

function signalMultiplier(signal: StrategySignal) {
  return signal === "wait" ? 0.75 : 1;
}

function getMarketRegime(fgi: number, btcChange: number): MarketRegime {
  if (btcChange >= 1.5 && fgi >= 55) return "bull";
  if (btcChange <= -1.5 && fgi <= 45) return "bear";
  return "range";
}

function getMarketVolatility(btcChange: number) {
  const absMove = Math.abs(btcChange);
  if (absMove >= 4) return "high";
  if (absMove >= 1.5) return "medium";
  return "low";
}

function getRiskBandStyle(riskBand: RiskBand) {
  if (riskBand === "low") return "text-success border-success/30 bg-success/10";
  if (riskBand === "medium") {
    return "text-amber-700 border-amber-300 bg-amber-100/60";
  }
  return "text-destructive border-destructive/30 bg-destructive/10";
}

function computeStrategies(
  fearGreedIndex: number,
  btcChange: number,
  regime: MarketRegime,
): { strategies: Strategy[]; volatility: string } {
  const fgi = clamp(fearGreedIndex, 0, 100);
  const normalizedBtcChange = btcChange ?? 0;
  const btcDir =
    normalizedBtcChange > 0.6
      ? "up"
      : normalizedBtcChange < -0.6
        ? "down"
        : "flat";
  const volatility = getMarketVolatility(normalizedBtcChange);

  const strategies: Strategy[] = [
    {
      id: "trend-follow",
      name: "Trend Momentum",
      nameMn: "Чиг хандлагын моментум",
      type: "trend",
      signal:
        btcDir === "up" && fgi > 45
          ? "long"
          : btcDir === "down" && fgi < 40
            ? "short"
            : "wait",
      winRate: btcDir !== "flat" ? 68 : 54,
      riskReward: "1:2.5",
      description: `Follow dominant ${btcDir === "up" ? "uptrend" : btcDir === "down" ? "downtrend" : "consolidation"} using EMA crossovers and volume confirmation. Best in directional markets.`,
      descriptionMn: `${btcDir === "up" ? "Өсөх" : btcDir === "down" ? "Буурах" : "Хажуу"} чиг хандлагыг EMA огтлолцол, эзэлхүүний баталгаажуулалтаар дагах. Чиглэлтэй захад тохиромжтой.`,
      pairs: ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
      confidence: btcDir !== "flat" ? 74 : 50,
      riskBand: "medium",
      timeframe: "4h-1d",
      timeframeMn: "4ц-1хон",
      positionSizePct: regime === "range" ? 9 : 12,
      stopLossPct: 2.8,
      rationale: [
        "EMA trend alignment on major pairs",
        "Volume confirms directional continuation",
      ],
      rationaleMn: [
        "Том хосууд дээр EMA тренд давхцаж байна",
        "Эзэлхүүн чиглэлийн үргэлжлэлийг баталж байна",
      ],
      invalidation: "Close if EMA 20/50 cross reverses and volume fades",
      invalidationMn: "EMA 20/50 эсрэг огтлолцож, эзэлхүүн буурвал хаана",
      score: 0,
    },
    {
      id: "mean-revert",
      name: "Mean Reversion",
      nameMn: "Дундаж руу буцах",
      type: "reversal",
      signal: fgi < 25 ? "long" : fgi > 75 ? "short" : "wait",
      winRate: fgi < 30 || fgi > 70 ? 71 : 55,
      riskReward: "1:1.8",
      description: `RSI extremes + Bollinger Band squeeze. Fear/Greed at ${fgi} - ${fgi < 30 ? "oversold, watch for bounce" : fgi > 70 ? "overbought, watch for pullback" : "no extreme, wait for setup"}.`,
      descriptionMn: `RSI хэт + Bollinger Band шахалт. Fear/Greed ${fgi} - ${fgi < 30 ? "хэт борлуулалт, сэргэлт хүлээ" : fgi > 70 ? "хэт худалдан авалт, буурах" : "хэт утга алга, setup хүлээ"}.`,
      pairs: ["BTC/USDT", "ETH/USDT"],
      confidence: fgi < 25 || fgi > 75 ? 72 : 45,
      riskBand: "high",
      timeframe: "1h-6h",
      timeframeMn: "1ц-6ц",
      positionSizePct: 6,
      stopLossPct: 2.2,
      rationale: [
        "Sentiment is stretched at extremes",
        "Volatility mean-reverts after panic/euphoria",
      ],
      rationaleMn: [
        "Sentiment туйлдаа хүрсэн байна",
        "Айдас/хэтрэлтийн дараа хэлбэлзэл дундаж руу буцдаг",
      ],
      invalidation: "Invalidate on strong breakout with rising volume",
      invalidationMn: "Эзэлхүүн өссөн хүчтэй тасалт гарвал хүчингүй",
      score: 0,
    },
    {
      id: "breakout-vol",
      name: "Volume Breakout",
      nameMn: "Эзэлхүүний тасалт",
      type: "breakout",
      signal: btcDir === "flat" ? "wait" : btcDir === "up" ? "long" : "short",
      winRate: 62,
      riskReward: "1:3.0",
      description:
        "Detect range consolidation then enter on volume spike above resistance or below support. High reward but requires patience.",
      descriptionMn:
        "Range нэгтгэлийг илрүүлж, resistance/support-оос эзэлхүүний spike-аар орох. Өндөр шагнал, тэвчээр шаардана.",
      pairs: ["SOL/USDT", "AVAX/USDT", "BTC/USDT"],
      confidence: btcDir === "flat" ? 42 : 63,
      riskBand: "high",
      timeframe: "15m-4h",
      timeframeMn: "15м-4ц",
      positionSizePct: volatility === "high" ? 5 : 8,
      stopLossPct: 3.4,
      rationale: [
        "Compression often leads to expansion",
        "Higher R:R when breakout is confirmed",
      ],
      rationaleMn: [
        "Шахалт дараа нь ихэвчлэн тэлэлт авчирдаг",
        "Тасалт батлагдвал ашиг/эрсдэлийн харьцаа өндөр",
      ],
      invalidation: "Exit if breakout candle fails and re-enters range",
      invalidationMn: "Тасалт буцаад range руу орвол шууд гарна",
      score: 0,
    },
    {
      id: "dca-smart",
      name: "Smart DCA",
      nameMn: "Ухаалаг DCA",
      type: "scalp",
      signal: fgi < 40 ? "long" : "wait",
      winRate: 78,
      riskReward: "1:1.5",
      description: `Dollar-cost average into dips. Current Fear/Greed ${fgi} - ${fgi < 35 ? "ideal DCA zone, accumulate" : fgi < 50 ? "moderate zone, small entries" : "expensive zone, hold off"}.`,
      descriptionMn: `Буурах үед Dollar-cost average хийх. Fear/Greed ${fgi} - ${fgi < 35 ? "тохиромжтой DCA бүс, хуримтлуул" : fgi < 50 ? "дунд бүс, бага оролт" : "үнэтэй бүс, хүлээ"}.`,
      pairs: ["BTC/USDT", "ETH/USDT"],
      confidence: fgi < 35 ? 82 : fgi < 50 ? 65 : 40,
      riskBand: "low",
      timeframe: "1d-1w",
      timeframeMn: "1хон-1долоо",
      positionSizePct: fgi < 35 ? 14 : 8,
      stopLossPct: 4.5,
      rationale: [
        "Reduces timing risk during pullbacks",
        "Best for high conviction assets",
      ],
      rationaleMn: [
        "Бууралтын үеийн timing эрсдэлийг бууруулна",
        "Итгэлтэй гол активуудад хамгийн тохиромжтой",
      ],
      invalidation: "Pause entries if macro trend breaks below weekly support",
      invalidationMn: "Долоо хоногийн support эвдэрвэл худалдан авалтыг зогсоо",
      score: 0,
    },
  ];

  const scored = strategies.map((strategy) => {
    const rr = parseRiskReward(strategy.riskReward);
    const riskPenalty =
      strategy.riskBand === "low" ? 0 : strategy.riskBand === "medium" ? 3 : 6;
    const score =
      strategy.confidence * 0.45 +
      strategy.winRate * 0.35 +
      rr * 12 * signalMultiplier(strategy.signal) -
      riskPenalty;

    return {
      ...strategy,
      score: Number(score.toFixed(1)),
    };
  });

  return {
    strategies: scored.sort(
      (left, right) =>
        right.score - left.score || left.id.localeCompare(right.id),
    ),
    volatility,
  };
}

function getDefaultBuilderConfig(aiSignals: AITradeSignal[]): BuilderConfig {
  const topSignal = [...aiSignals].sort(
    (left, right) => right.confidence - left.confidence,
  )[0];

  return {
    name: "",
    market: topSignal?.symbol?.toUpperCase() ?? "any",
    minSignalConfidence: clamp(topSignal?.confidence ?? 70, 40, 95),
    allowLong: true,
    allowShort: false,
    useRsi: true,
    useMacd: true,
    useMovingAverage: true,
    useVolumeSpike: false,
    rsiOversold: 32,
    rsiOverbought: 68,
    riskProfile: "balanced",
    maxPositionSize: 12,
    maxDailyLoss: 5,
    stopLossMode: "fixed",
    stopLossPct: 3.2,
    takeProfitPct: 7.5,
    useTrailingStop: false,
  };
}

function buildRuleSummary(config: BuilderConfig) {
  const aiDirections = [
    config.allowLong ? "LONG" : null,
    config.allowShort ? "SHORT" : null,
  ]
    .filter(Boolean)
    .join(" / ");

  const indicators = [
    config.useRsi ? `RSI(${config.rsiOversold}-${config.rsiOverbought})` : null,
    config.useMacd ? "MACD trend" : null,
    config.useMovingAverage ? "MA alignment" : null,
    config.useVolumeSpike ? "Volume spike" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return [
    `Entry: AI signal >= ${config.minSignalConfidence}% confidence (${aiDirections || "disabled"}) on ${config.market === "any" ? "all tracked pairs" : config.market}`,
    `Filters: ${indicators || "No indicator filter"}`,
    `Risk: ${config.riskProfile} profile, max position ${config.maxPositionSize}%, max daily loss ${config.maxDailyLoss}%`,
    `Exit: stop loss ${config.stopLossPct}% (${config.stopLossMode}), take profit ${config.takeProfitPct}%${config.useTrailingStop ? ", trailing stop enabled" : ""}`,
  ];
}

export function StrategyPanel({
  fearGreedIndex,
  btcChange24h,
  aiSignals = [],
}: StrategyPanelProps) {
  const { t } = useLanguage();
  const router = useRouter();

  const safeFgi = clamp(fearGreedIndex, 0, 100);
  const safeBtcChange = btcChange24h ?? 0;
  const marketRegime = getMarketRegime(safeFgi, safeBtcChange);
  const { strategies, volatility } = useMemo(
    () => computeStrategies(safeFgi, safeBtcChange, marketRegime),
    [safeFgi, safeBtcChange, marketRegime],
  );

  const topStrategy = strategies[0];
  const hasTradeSignal = topStrategy.signal !== "wait";
  const confidencePercent = clamp(topStrategy.confidence, 0, 100);
  const riskBufferPercent = clamp(100 - safeFgi, 10, 90);

  const marketOptions = useMemo(() => {
    const symbols = Array.from(
      new Set(
        aiSignals
          .map((signal) => signal.symbol?.toUpperCase())
          .filter((symbol): symbol is string => Boolean(symbol)),
      ),
    ).sort((left, right) => left.localeCompare(right));
    return ["any", ...symbols];
  }, [aiSignals]);

  const [builder, setBuilder] = useState<BuilderConfig>(() =>
    getDefaultBuilderConfig(aiSignals),
  );
  const [savedStrategies, setSavedStrategies] = useState<SavedCustomStrategy[]>(
    [],
  );
  const [activeStrategyId, setActiveStrategyIdState] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(STRATEGY_BUILDER_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as SavedCustomStrategy[];
      if (Array.isArray(parsed)) setSavedStrategies(parsed);
    } catch {
      setSavedStrategies([]);
    }

    const activeId = window.localStorage.getItem(ACTIVE_CUSTOM_STRATEGY_ID_KEY);
    if (activeId) setActiveStrategyIdState(activeId);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      STRATEGY_BUILDER_STORAGE_KEY,
      JSON.stringify(savedStrategies),
    );
  }, [savedStrategies]);

  useEffect(() => {
    if (builder.market === "any") return;
    if (marketOptions.includes(builder.market)) return;
    setBuilder((prev) => ({ ...prev, market: marketOptions[0] ?? "any" }));
  }, [builder.market, marketOptions]);

  const builderRuleSummary = useMemo(
    () => buildRuleSummary(builder),
    [builder],
  );

  const updateBuilder = (patch: Partial<BuilderConfig>) => {
    setBuilder((prev) => ({ ...prev, ...patch }));
  };

  const saveCustomStrategy = () => {
    if (!builder.name.trim()) return;
    if (!builder.allowLong && !builder.allowShort) return;

    const item: SavedCustomStrategy = {
      id: `${Date.now()}`,
      createdAt: new Date().toISOString(),
      config: builder,
    };

    setSavedStrategies((prev) => [item, ...prev].slice(0, 8));
    setBuilder((prev) => ({ ...prev, name: "" }));
  };

  const setActiveStrategy = (strategyId: string | null) => {
    setActiveCustomStrategyId(strategyId);
    setActiveStrategyIdState(strategyId);
  };

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

  const signalLabel = (signal: StrategySignal) => {
    if (signal === "long") return t("LONG", "АВАХ");
    if (signal === "short") return t("SHORT", "ЗАРАХ");
    return t("WAIT", "ХҮЛЭЭХ");
  };

  const regimeLabel =
    marketRegime === "bull"
      ? t("Bull Regime", "Өсөх зах")
      : marketRegime === "bear"
        ? t("Bear Regime", "Буурах зах")
        : t("Range Regime", "Хажуу зах");

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

  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Activity className="h-4 w-4 text-primary" />
            {t("AI Strategies", "AI стратегиуд")}
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">
            {t("Auto-computed", "Автомат тооцоолсон")}
          </Badge>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">
            <Brain className="mr-1 h-3 w-3" />
            {regimeLabel}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            <Gauge className="mr-1 h-3 w-3" />
            {t("FGI", "FGI")}: {safeFgi}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              safeBtcChange >= 0
                ? "text-success border-success/30"
                : "text-destructive border-destructive/30",
            )}
          >
            BTC 24h: {safeBtcChange >= 0 ? "+" : ""}
            {safeBtcChange.toFixed(2)}%
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {t("Volatility", "Хэлбэлзэл")}: {volatility}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div
          className={cn("rounded-lg border p-3", signalBg(topStrategy.signal))}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">
                {t("Recommended", "Зөвлөмж")}
              </span>
            </div>
            <Badge
              className={cn(
                "uppercase bg-white",
                signalColor(topStrategy.signal),
              )}
            >
              {signalLabel(topStrategy.signal)}
            </Badge>
          </div>

          <p className="mt-1 text-sm font-medium text-foreground">
            {t(topStrategy.name, topStrategy.nameMn)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(topStrategy.description, topStrategy.descriptionMn)}
          </p>

          <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
            <Badge variant="secondary">
              {t("Win rate", "Ялалт")} {topStrategy.winRate}%
            </Badge>
            <Badge variant="secondary">R:R {topStrategy.riskReward}</Badge>
            <Badge variant="secondary">
              {t("Confidence", "Итгэлцэл")} {topStrategy.confidence}%
            </Badge>
            <Badge variant="secondary">
              {t("Size", "Хэмжээ")} {topStrategy.positionSizePct}%
            </Badge>
            <Badge
              variant="outline"
              className={cn("border", getRiskBandStyle(topStrategy.riskBand))}
            >
              {t("Risk", "Эрсдэл")} {topStrategy.riskBand}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {t("Timeframe", "Хугацаа")}{" "}
              {t(topStrategy.timeframe, topStrategy.timeframeMn)}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {t("Stop", "Stop")} {topStrategy.stopLossPct}%
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
                  topStrategy.signal === "long"
                    ? "bg-primary"
                    : topStrategy.signal === "short"
                      ? "bg-destructive"
                      : "bg-muted-foreground",
                )}
                style={{ width: `${confidencePercent}%` }}
              />
            </div>
          </div>

          <div className="mt-3 grid gap-1">
            {topStrategy.rationale.slice(0, 2).map((reason, idx) => (
              <p
                key={`${topStrategy.id}-reason-${idx}`}
                className="text-[11px] text-muted-foreground"
              >
                • {t(reason, topStrategy.rationaleMn[idx])}
              </p>
            ))}
          </div>

          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("Invalidation", "Хүчингүй болох нөхцөл")}:{" "}
            {t(topStrategy.invalidation, topStrategy.invalidationMn)}
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

        <div className="grid gap-2 sm:grid-cols-3">
          {strategies.slice(1).map((strategy) => {
            const Icon = typeIcon(strategy.type);
            return (
              <div
                key={strategy.id}
                className={cn(
                  "rounded-lg border p-2.5 transition-colors",
                  signalBg(strategy.signal),
                )}
              >
                <div className="flex items-center justify-between">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px] uppercase",
                      signalColor(strategy.signal),
                    )}
                  >
                    {signalLabel(strategy.signal)}
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
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {strategy.pairs.slice(0, 2).map((pair) => (
                    <Badge
                      key={`${strategy.id}-${pair}`}
                      variant="secondary"
                      className="text-[9px]"
                    >
                      {pair}
                    </Badge>
                  ))}
                  {strategy.pairs.length > 2 && (
                    <Badge variant="outline" className="text-[9px]">
                      +{strategy.pairs.length - 2}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-lg border border-border/60 bg-card/70 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold text-foreground">
                {t("Strategy Builder", "Стратеги бүтээгч")}
              </p>
            </div>
            <Badge variant="outline" className="text-[10px]">
              {t("No coding required", "Код бичих шаардлагагүй")}
            </Badge>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground">
                  {t("Strategy Name", "Стратегийн нэр")}
                </p>
                <Input
                  value={builder.name}
                  onChange={(event) =>
                    updateBuilder({ name: event.target.value })
                  }
                  placeholder={t(
                    "e.g. ETH Momentum Breakout",
                    "ж. ETH Моментум Тасалт",
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground">
                  {t("Market", "Зах")}
                </p>
                <Select
                  value={builder.market}
                  onValueChange={(value) => updateBuilder({ market: value })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={t("Select market", "Зах сонгох")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {marketOptions.map((market) => (
                      <SelectItem key={market} value={market}>
                        {market === "any" ? t("Any market", "Бүх зах") : market}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-md border border-border/60 bg-muted/20 p-2.5">
                <p className="text-[11px] font-medium text-foreground">
                  {t("AI Signal Rules", "AI дохионы дүрэм")}
                </p>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {t("Minimum confidence", "Хамгийн бага итгэлцэл")}
                    </span>
                    <span>{builder.minSignalConfidence}%</span>
                  </div>
                  <Slider
                    value={[builder.minSignalConfidence]}
                    onValueChange={([value]) =>
                      updateBuilder({ minSignalConfidence: value })
                    }
                    max={95}
                    min={40}
                    step={1}
                  />
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <label className="flex items-center gap-2 text-muted-foreground">
                      <Checkbox
                        checked={builder.allowLong}
                        onCheckedChange={(checked) =>
                          updateBuilder({ allowLong: checked === true })
                        }
                      />
                      LONG
                    </label>
                    <label className="flex items-center gap-2 text-muted-foreground">
                      <Checkbox
                        checked={builder.allowShort}
                        onCheckedChange={(checked) =>
                          updateBuilder({ allowShort: checked === true })
                        }
                      />
                      SHORT
                    </label>
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-border/60 bg-muted/20 p-2.5">
                <p className="text-[11px] font-medium text-foreground">
                  {t("Technical Indicators", "Техникийн индикатор")}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <label className="flex items-center gap-2 text-muted-foreground">
                    <Checkbox
                      checked={builder.useRsi}
                      onCheckedChange={(checked) =>
                        updateBuilder({ useRsi: checked === true })
                      }
                    />
                    RSI
                  </label>
                  <label className="flex items-center gap-2 text-muted-foreground">
                    <Checkbox
                      checked={builder.useMacd}
                      onCheckedChange={(checked) =>
                        updateBuilder({ useMacd: checked === true })
                      }
                    />
                    MACD
                  </label>
                  <label className="flex items-center gap-2 text-muted-foreground">
                    <Checkbox
                      checked={builder.useMovingAverage}
                      onCheckedChange={(checked) =>
                        updateBuilder({ useMovingAverage: checked === true })
                      }
                    />
                    MA Trend
                  </label>
                  <label className="flex items-center gap-2 text-muted-foreground">
                    <Checkbox
                      checked={builder.useVolumeSpike}
                      onCheckedChange={(checked) =>
                        updateBuilder({ useVolumeSpike: checked === true })
                      }
                    />
                    Volume Spike
                  </label>
                </div>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{t("RSI oversold", "RSI хэт борлуулалт")}</span>
                    <span>{builder.rsiOversold}</span>
                  </div>
                  <Slider
                    value={[builder.rsiOversold]}
                    onValueChange={([value]) =>
                      updateBuilder({ rsiOversold: value })
                    }
                    max={45}
                    min={15}
                    step={1}
                  />
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{t("RSI overbought", "RSI хэт худалдан авалт")}</span>
                    <span>{builder.rsiOverbought}</span>
                  </div>
                  <Slider
                    value={[builder.rsiOverbought]}
                    onValueChange={([value]) =>
                      updateBuilder({ rsiOverbought: value })
                    }
                    max={85}
                    min={55}
                    step={1}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-md border border-border/60 bg-muted/20 p-2.5">
                <p className="text-[11px] font-medium text-foreground">
                  {t("Risk Settings", "Эрсдэлийн тохиргоо")}
                </p>
                <div className="mt-2 space-y-2.5">
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-muted-foreground">
                      {t("Risk profile", "Эрсдэлийн түвшин")}
                    </p>
                    <Select
                      value={builder.riskProfile}
                      onValueChange={(value) =>
                        updateBuilder({ riskProfile: value as RiskProfile })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="conservative">
                          {t("Conservative", "Болгоомжтой")}
                        </SelectItem>
                        <SelectItem value="balanced">
                          {t("Balanced", "Тэнцвэртэй")}
                        </SelectItem>
                        <SelectItem value="aggressive">
                          {t("Aggressive", "Идэвхтэй")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {t("Max position size", "Нэг позицийн дээд хэмжээ")}
                    </span>
                    <span>{builder.maxPositionSize}%</span>
                  </div>
                  <Slider
                    value={[builder.maxPositionSize]}
                    onValueChange={([value]) =>
                      updateBuilder({ maxPositionSize: value })
                    }
                    max={35}
                    min={3}
                    step={1}
                  />

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {t("Max daily loss", "Өдрийн алдагдлын дээд хэмжээ")}
                    </span>
                    <span>{builder.maxDailyLoss}%</span>
                  </div>
                  <Slider
                    value={[builder.maxDailyLoss]}
                    onValueChange={([value]) =>
                      updateBuilder({ maxDailyLoss: value })
                    }
                    max={15}
                    min={1}
                    step={1}
                  />
                </div>
              </div>

              <div className="rounded-md border border-border/60 bg-muted/20 p-2.5">
                <p className="text-[11px] font-medium text-foreground">
                  {t("Stop Loss & Take Profit", "Stop loss ба take profit")}
                </p>
                <div className="mt-2 space-y-2.5">
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-muted-foreground">
                      {t("Stop mode", "Stop горим")}
                    </p>
                    <Select
                      value={builder.stopLossMode}
                      onValueChange={(value) =>
                        updateBuilder({ stopLossMode: value as StopLossMode })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">
                          {t("Fixed percent", "Тогтмол хувь")}
                        </SelectItem>
                        <SelectItem value="dynamic">
                          {t("Dynamic by volatility", "Хэлбэлзлээр динамик")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{t("Stop loss", "Stop loss")}</span>
                    <span>{builder.stopLossPct.toFixed(1)}%</span>
                  </div>
                  <Slider
                    value={[builder.stopLossPct]}
                    onValueChange={([value]) =>
                      updateBuilder({ stopLossPct: Number(value.toFixed(1)) })
                    }
                    max={12}
                    min={0.5}
                    step={0.1}
                  />

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{t("Take profit", "Take profit")}</span>
                    <span>{builder.takeProfitPct.toFixed(1)}%</span>
                  </div>
                  <Slider
                    value={[builder.takeProfitPct]}
                    onValueChange={([value]) =>
                      updateBuilder({ takeProfitPct: Number(value.toFixed(1)) })
                    }
                    max={25}
                    min={1}
                    step={0.1}
                  />

                  <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/60 p-2">
                    <span className="text-[11px] text-muted-foreground">
                      {t("Enable trailing stop", "Trailing stop идэвхжүүлэх")}
                    </span>
                    <Switch
                      checked={builder.useTrailingStop}
                      onCheckedChange={(checked) =>
                        updateBuilder({ useTrailingStop: checked })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <p className="text-[11px] font-medium text-foreground">
                    {t("Generated Strategy Logic", "Үүсгэсэн стратегийн логик")}
                  </p>
                </div>
                <div className="mt-2 space-y-1">
                  {builderRuleSummary.map((line, index) => (
                    <p
                      key={`builder-line-${index}`}
                      className="text-[11px] text-muted-foreground"
                    >
                      {index + 1}. {line}
                    </p>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  {t(
                    "Strategies are saved locally to your browser.",
                    "Стратеги таны browser-д локал хадгалагдана.",
                  )}
                </p>
                <Button
                  size="sm"
                  className="h-8 gap-1"
                  disabled={
                    !builder.name.trim() ||
                    (!builder.allowLong && !builder.allowShort)
                  }
                  onClick={saveCustomStrategy}
                >
                  <Save className="h-3.5 w-3.5" />
                  {t("Save Strategy", "Стратеги хадгалах")}
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-3">
            <p className="mb-2 text-[11px] font-medium text-muted-foreground">
              {t("Your Custom Strategies", "Таны өөрийн стратегиуд")} (
              {savedStrategies.length})
            </p>
            {savedStrategies.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {t(
                  "No custom strategy yet. Configure and save your first one.",
                  "Одоогоор custom стратеги алга. Анхны стратегиа тохируулаад хадгална уу.",
                )}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {savedStrategies.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-md border border-border/60 bg-background/60 p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="line-clamp-1 text-xs font-semibold text-foreground">
                        {entry.config.name}
                      </p>
                      <Badge variant="outline" className="text-[9px]">
                        {entry.config.market === "any"
                          ? t("Any", "Бүх")
                          : entry.config.market}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {t("AI >=", "AI >=")} {entry.config.minSignalConfidence}%
                      · {t("SL", "SL")} {entry.config.stopLossPct.toFixed(1)}% ·{" "}
                      {t("TP", "TP")} {entry.config.takeProfitPct.toFixed(1)}%
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString()}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <Button
                        size="sm"
                        variant={
                          activeStrategyId === entry.id ? "default" : "outline"
                        }
                        className="h-7 text-[10px]"
                        onClick={() =>
                          setActiveStrategy(
                            activeStrategyId === entry.id ? null : entry.id,
                          )
                        }
                      >
                        {activeStrategyId === entry.id
                          ? t("Active for AI Trading", "AI арилжаанд идэвхтэй")
                          : t("Use For AI Trading", "AI арилжаанд ашиглах")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {savedStrategies.length > 0 && activeStrategyId && (
              <p className="mt-2 text-[10px] text-primary">
                {t(
                  "Selected strategy is now controlling demo AI auto-trading.",
                  "Сонгосон стратеги demo AI auto-trading-ийг одоо удирдаж байна.",
                )}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-md border border-border/50 bg-muted/20 p-2">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              {t("Capital protection buffer", "Капитал хамгаалах нөөц")}
            </span>
            <span>{riskBufferPercent}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-success transition-all"
              style={{ width: `${riskBufferPercent}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-[10px] text-muted-foreground">
            {t(
              "Strategies adapt to live market conditions. Always use stop loss and size discipline.",
              "Стратегиуд захын нөхцөлд тохирно. Stop loss болон хэмжээг заавал баримтал.",
            )}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => router.push("/optimizer")}
            >
              {t("Open Optimizer", "Optimizer нээх")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-primary"
              onClick={() => router.push("/signals")}
            >
              {t("View Signals", "Дохио харах")}
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
