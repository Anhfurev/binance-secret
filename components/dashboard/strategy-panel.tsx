"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, Brain, Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/components/language-provider";
import {
  ACTIVE_CUSTOM_STRATEGY_ID_KEY,
  STRATEGY_BUILDER_STORAGE_KEY,
  setActiveCustomStrategyId,
  type SavedCustomStrategy,
} from "@/lib/trading/custom-strategy";
import { StrategyBuilderCard } from "@/components/dashboard/strategy-panel/strategy-builder-card";
import { StrategyGrid } from "@/components/dashboard/strategy-panel/strategy-grid";
import { StrategyRecommendation } from "@/components/dashboard/strategy-panel/strategy-recommendation";
import {
  buildRuleSummary,
  clamp,
  computeStrategies,
  getDefaultBuilderConfig,
  getMarketRegime,
} from "@/components/dashboard/strategy-panel/strategy-engine";
import type { BuilderConfig, StrategyPanelProps } from "@/components/dashboard/strategy-panel/types";

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
  const [savedStrategies, setSavedStrategies] = useState<SavedCustomStrategy[]>(() => {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(STRATEGY_BUILDER_STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as SavedCustomStrategy[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [activeStrategyId, setActiveStrategyIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ACTIVE_CUSTOM_STRATEGY_ID_KEY);
  });

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
    const next = marketOptions[0] ?? "any";
    void Promise.resolve().then(() => {
      setBuilder((prev) => ({ ...prev, market: next }));
    });
  }, [builder.market, marketOptions]);

  const builderRuleSummary = useMemo(() => buildRuleSummary(builder), [builder]);
  const updateBuilder = (patch: Partial<BuilderConfig>) =>
    setBuilder((prev) => ({ ...prev, ...patch }));

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

  const regimeLabel =
    marketRegime === "bull"
      ? t("Bull Regime", "Өсөх зах")
      : marketRegime === "bear"
        ? t("Bear Regime", "Буурах зах")
        : t("Range Regime", "Хажуу зах");

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
        <StrategyRecommendation
          t={t}
          strategy={topStrategy}
          hasTradeSignal={hasTradeSignal}
          confidencePercent={confidencePercent}
        />
        <StrategyGrid t={t} strategies={strategies} />
        <StrategyBuilderCard
          t={t}
          builder={builder}
          marketOptions={marketOptions}
          builderRuleSummary={builderRuleSummary}
          savedStrategies={savedStrategies}
          activeStrategyId={activeStrategyId}
          onUpdateBuilder={updateBuilder}
          onSaveCustomStrategy={saveCustomStrategy}
          onSetActiveStrategy={setActiveStrategy}
        />

        {savedStrategies.length > 0 && activeStrategyId && (
          <p className="text-[10px] text-primary">
            {t(
              "Selected strategy is now controlling demo AI auto-trading.",
              "Сонгосон стратеги demo AI auto-trading-ийг одоо удирдаж байна.",
            )}
          </p>
        )}

        <div className="rounded-md border border-border/50 bg-muted/20 p-2">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{t("Capital protection buffer", "Капитал хамгаалах нөөц")}</span>
            <span>{riskBufferPercent}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
            <div className="h-full rounded-full bg-success transition-all" style={{ width: `${riskBufferPercent}%` }} />
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
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => router.push("/optimizer")}>
              {t("Open Optimizer", "Optimizer нээх")}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-primary" onClick={() => router.push("/signals")}>
              {t("View Signals", "Дохио харах")}
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
