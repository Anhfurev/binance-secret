"use client";

import { useState, useMemo } from "react";
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
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sparkles,
  Shield,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Zap,
  Target,
  PieChart,
  RefreshCw,
  Info,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { mockPortfolio } from "@/lib/mock-data";
import type { PortfolioRecommendation } from "@/lib/types";
import { toast } from "sonner";
import { useLanguage } from "@/components/language-provider";

// Allocation targets per risk profile: { conservative, balanced, aggressive }
// Each maps to BTC, ETH, SOL, Stables suggested %
const profileAllocations: Record<
  string,
  { btc: number; eth: number; sol: number; stables: number }
> = {
  conservative: { btc: 60, eth: 25, sol: 5, stables: 10 },
  balanced: { btc: 50, eth: 30, sol: 15, stables: 5 },
  aggressive: { btc: 35, eth: 30, sol: 28, stables: 7 },
};

function computeOptimization(
  profile: string,
  tolerance: number,
  currentAssets: typeof mockPortfolio.assets,
  currentRisk: number,
) {
  // Interpolate allocations: at tolerance=0 lean conservative, at tolerance=100 lean aggressive
  const base = profileAllocations[profile] ?? profileAllocations.balanced;

  // Shift toward aggressive as tolerance increases
  const aggressiveShift = (tolerance - 50) / 100; // -0.5 to +0.5
  const clamp = (v: number) => Math.max(0, Math.min(100, v));

  const alloc = {
    btc: clamp(Math.round(base.btc - aggressiveShift * 10)),
    eth: clamp(Math.round(base.eth + aggressiveShift * 4)),
    sol: clamp(Math.round(base.sol + aggressiveShift * 8)),
    stables: 0,
  };
  alloc.stables = Math.max(0, 100 - alloc.btc - alloc.eth - alloc.sol);

  // Risk & return calculations
  const riskByProfile: Record<string, number> = {
    conservative: 22,
    balanced: 35,
    aggressive: 55,
  };
  const baseRisk = riskByProfile[profile] ?? 35;
  const optimizedRisk = clamp(Math.round(baseRisk + aggressiveShift * 12));
  const riskReduction = currentRisk - optimizedRisk;
  const expectedReturn =
    profile === "aggressive"
      ? 28.5 + aggressiveShift * 8
      : profile === "conservative"
        ? 9.5 + aggressiveShift * 4
        : 18.5 + aggressiveShift * 6;

  const sharpeOld =
    profile === "aggressive" ? 1.25 : profile === "conservative" ? 1.6 : 1.45;
  const sharpeNew =
    sharpeOld + (riskReduction > 0 ? riskReduction * 0.01 : 0) + 0.2;

  // Build recommendations
  const current: Record<string, number> = {};
  for (const a of currentAssets) current[a.symbol] = a.allocation;

  const recommendations: PortfolioRecommendation[] = [];

  const diff = (sym: string, suggested: number) => {
    const cur = current[sym] ?? 0;
    const delta = suggested - cur;
    if (Math.abs(delta) < 1) return; // skip tiny changes
    const type: PortfolioRecommendation["type"] =
      suggested === 0
        ? "remove"
        : delta > 0
          ? cur === 0
            ? "add"
            : "add"
          : Math.abs(delta) > 5
            ? "rebalance"
            : "reduce";
    const priority: PortfolioRecommendation["priority"] =
      Math.abs(delta) > 8 ? "high" : Math.abs(delta) > 3 ? "medium" : "low";
    const reasonMap: Record<string, string> = {
      BTC:
        delta < 0
          ? "BTC allocation exceeds optimal risk-adjusted level. Reducing exposure allows for better diversification."
          : "Increasing BTC allocation strengthens the portfolio's blue-chip base for more stability.",
      ETH:
        delta > 0
          ? "ETH showing strong fundamentals with L2 growth. Increasing allocation captures ecosystem expansion."
          : "Reducing ETH to maintain balanced diversification in current market conditions.",
      SOL:
        delta > 0
          ? "SOL momentum indicates potential outperformance. Increase aligns with risk-on market conditions."
          : "Reducing SOL exposure to limit high-volatility asset risk.",
      Stables:
        delta > 0
          ? "Adding stablecoins provides dry powder for buying opportunities and reduces portfolio volatility."
          : "Reducing stablecoin allocation to maximize growth potential in a bullish environment.",
    };
    recommendations.push({
      type,
      coinId: sym.toLowerCase(),
      symbol: sym,
      currentAllocation: cur,
      suggestedAllocation: suggested,
      reason:
        reasonMap[sym] ??
        `Adjust ${sym} from ${cur.toFixed(1)}% to ${suggested}%`,
      priority,
    });
  };

  diff("BTC", alloc.btc);
  diff("ETH", alloc.eth);
  diff("SOL", alloc.sol);
  if (alloc.stables > 2) diff("Stables", alloc.stables);

  // Sort by priority
  const order = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => order[a.priority] - order[b.priority]);

  return {
    alloc,
    optimizedRisk,
    expectedReturn: +expectedReturn.toFixed(1),
    riskReduction,
    sharpeOld: +sharpeOld.toFixed(2),
    sharpeNew: +sharpeNew.toFixed(2),
    recommendations,
  };
}

const riskProfiles = [
  {
    id: "conservative",
    label: "Conservative",
    description: "Lower risk, stable returns",
    color: "text-info",
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Moderate risk/reward",
    color: "text-primary",
  },
  {
    id: "aggressive",
    label: "Aggressive",
    description: "Higher risk, higher potential",
    color: "text-warning",
  },
];

export default function OptimizerPage() {
  const { t } = useLanguage();
  const tr = (en: string, mn: string) => t(en, mn);
  const [selectedProfile, setSelectedProfile] = useState("balanced");
  const [riskTolerance, setRiskTolerance] = useState([50]);
  const [autoRebalance, setAutoRebalance] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [dismissedSymbols, setDismissedSymbols] = useState<Set<string>>(
    new Set(),
  );
  const [appliedSymbols, setAppliedSymbols] = useState<Set<string>>(new Set());

  const [portfolioAssets, setPortfolioAssets] = useState(() =>
    mockPortfolio.assets.map((a) => ({ ...a })),
  );
  const [currentRiskScore, setCurrentRiskScore] = useState(
    mockPortfolio.riskScore,
  );

  const optimization = useMemo(
    () =>
      computeOptimization(
        selectedProfile,
        riskTolerance[0],
        portfolioAssets,
        currentRiskScore,
      ),
    [selectedProfile, riskTolerance, portfolioAssets, currentRiskScore],
  );

  const visibleRecommendations = optimization.recommendations.filter(
    (r) => !dismissedSymbols.has(r.symbol),
  );

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setDismissedSymbols(new Set());
    setAppliedSymbols(new Set());
    setPortfolioAssets(mockPortfolio.assets.map((a) => ({ ...a })));
    setCurrentRiskScore(mockPortfolio.riskScore);
    await new Promise((r) => setTimeout(r, 2000));
    setIsAnalyzing(false);
    toast.success(
      t("Portfolio analysis complete!", "Портфелийн анализ дууслаа!"),
      {
        description: t(
          "New recommendations generated based on current market conditions.",
          "Одоогийн захын нөхцөл дээр шинэ зөвлөмж гарлаа.",
        ),
      },
    );
  };

  const handleApplyRecommendation = (rec: PortfolioRecommendation) => {
    setPortfolioAssets((prev) => {
      const exists = prev.find((a) => a.symbol === rec.symbol);
      if (exists) {
        return prev.map((a) =>
          a.symbol === rec.symbol
            ? { ...a, allocation: rec.suggestedAllocation }
            : a,
        );
      }
      return [
        ...prev,
        {
          coinId: rec.coinId,
          symbol: rec.symbol,
          name: rec.symbol === "Stables" ? "Stablecoins (USDT)" : rec.symbol,
          amount: 0,
          value: 0,
          allocation: rec.suggestedAllocation,
          pnl24h: 0,
          pnlPercent24h: 0,
        },
      ];
    });
    setCurrentRiskScore(optimization.optimizedRisk);
    setAppliedSymbols((prev) => new Set(prev).add(rec.symbol));
    toast.success(
      t(
        `Applied: ${rec.symbol} → ${rec.suggestedAllocation}%`,
        `Хэрэгжүүллээ: ${rec.symbol} → ${rec.suggestedAllocation}%`,
      ),
      {
        description: t(
          `Allocation changed from ${rec.currentAllocation}% to ${rec.suggestedAllocation}%`,
          `Хуваарилалт ${rec.currentAllocation}%-аас ${rec.suggestedAllocation}% болж өөрчлөгдлөө`,
        ),
      },
    );
  };

  const handleDismissRecommendation = (rec: PortfolioRecommendation) => {
    setDismissedSymbols((prev) => new Set(prev).add(rec.symbol));
    toast(t(`Dismissed ${rec.symbol}`, `${rec.symbol} хаалаа`));
  };

  const handleApplyAll = () => {
    setPortfolioAssets((prev) => {
      const next = prev.map((a) => {
        const rec = visibleRecommendations.find((r) => r.symbol === a.symbol);
        return rec ? { ...a, allocation: rec.suggestedAllocation } : a;
      });
      for (const rec of visibleRecommendations) {
        if (!next.find((a) => a.symbol === rec.symbol)) {
          next.push({
            coinId: rec.coinId,
            symbol: rec.symbol,
            name: rec.symbol === "Stables" ? "Stablecoins (USDT)" : rec.symbol,
            amount: 0,
            value: 0,
            allocation: rec.suggestedAllocation,
            pnl24h: 0,
            pnlPercent24h: 0,
          });
        }
      }
      return next;
    });
    setCurrentRiskScore(optimization.optimizedRisk);
    const syms = new Set(appliedSymbols);
    for (const r of visibleRecommendations) syms.add(r.symbol);
    setAppliedSymbols(syms);
    toast.success(
      t(
        `Applied all ${visibleRecommendations.length} recommendations!`,
        `${visibleRecommendations.length} зөвлөмж бүгдийг хэрэгжүүллээ!`,
      ),
      {
        description: t(
          "Portfolio updated to optimized allocation. Run Analysis again to refresh.",
          "Багц оновчтой хуваарилалтад шинэчлэгдлээ. Дахин шинжилгээ ажиллуул.",
        ),
      },
    );
  };

  const handleDismissAll = () => {
    const syms = new Set(dismissedSymbols);
    for (const r of visibleRecommendations) syms.add(r.symbol);
    setDismissedSymbols(syms);
    toast(t("All recommendations dismissed", "Бүх зөвлөмж хаагдлаа"));
  };

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 md:px-6 lg:py-8">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="flex items-center gap-3 text-2xl font-bold text-foreground md:text-3xl">
                <Sparkles className="h-7 w-7 text-primary" />
                {t("Portfolio AI Optimizer", "Багцын AI оновчлогч")}
              </h1>
              <p className="mt-1 text-muted-foreground">
                {t(
                  "AI-powered portfolio optimization and risk analysis",
                  "AI суурьтай багцын оновчлол ба эрсдэлийн анализ",
                )}
              </p>
            </div>
            <Button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="bg-primary"
            >
              {isAnalyzing ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-2 h-4 w-4" />
              )}
              {isAnalyzing
                ? t("Analyzing...", "Шинжилж байна...")
                : t("Run Analysis", "Анализ ажиллуулах")}
            </Button>
          </div>
        </div>

        {/* Risk Overview */}
        <div className="mb-8 grid gap-6 lg:grid-cols-3">
          {/* Current vs Optimized */}
          <Card className="border-border/50 bg-card/60 backdrop-blur-sm lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                {t("Risk Analysis", "Эрсдэлийн анализ")}
              </CardTitle>
              <CardDescription>
                {t(
                  "Your current portfolio vs AI-optimized allocation",
                  "Таны одоогийн багц болон AI-оновчлогдсон хуваарилалт",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-8 md:grid-cols-2">
                {/* Current */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-foreground">
                      {t("Current Portfolio", "Одоогийн багц")}
                    </h4>
                    <Badge variant="outline" className="text-warning">
                      Risk Score: {currentRiskScore}
                    </Badge>
                  </div>

                  <div className="space-y-3">
                    {portfolioAssets.map((asset) => (
                      <div key={asset.coinId} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-foreground">
                            {asset.symbol}
                          </span>
                          <span className="text-muted-foreground">
                            {asset.allocation.toFixed(1)}%
                          </span>
                        </div>
                        <Progress value={asset.allocation} className="h-2" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Arrow */}
                <div className="hidden items-center justify-center md:flex">
                  <ArrowRight className="h-8 w-8 text-primary" />
                </div>

                {/* Optimized */}
                <div className="space-y-4 md:col-start-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-foreground">
                      {t("Optimized Portfolio", "Оновчлогдсон багц")}
                    </h4>
                    <Badge className="bg-success text-success-foreground">
                      Risk Score: {optimization.optimizedRisk}
                    </Badge>
                  </div>

                  <div className="space-y-3">
                    {[
                      { sym: "BTC", val: optimization.alloc.btc },
                      { sym: "ETH", val: optimization.alloc.eth },
                      { sym: "SOL", val: optimization.alloc.sol },
                      { sym: "Stables", val: optimization.alloc.stables },
                    ]
                      .filter((x) => x.val > 0)
                      .map((x) => (
                        <div key={x.sym} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-foreground">
                              {x.sym}
                            </span>
                            <span className="text-muted-foreground">
                              {x.val}.0%
                            </span>
                          </div>
                          <Progress value={x.val} className="h-2" />
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              {/* Improvement Summary */}
              <div className="mt-6 grid gap-4 rounded-lg bg-success/10 p-4 md:grid-cols-3">
                <div className="text-center">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Risk Reduction
                  </p>
                  <p className="mt-1 text-xl font-bold text-success">
                    -{optimization.riskReduction}%
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Expected Return
                  </p>
                  <p className="mt-1 text-xl font-bold text-success">
                    +{optimization.expectedReturn}%
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Sharpe Ratio
                  </p>
                  <p className="mt-1 text-xl font-bold text-foreground">
                    {optimization.sharpeOld} → {optimization.sharpeNew}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Risk Settings */}
          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                {t("Risk Profile", "Эрсдэлийн профайл")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Profile Selection */}
              <div className="space-y-3">
                {riskProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    onClick={() => setSelectedProfile(profile.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors",
                      selectedProfile === profile.id
                        ? "border-primary bg-primary/10"
                        : "border-border/50 hover:border-border",
                    )}
                  >
                    <div>
                      <p className={cn("font-medium", profile.color)}>
                        {tr(
                          profile.label,
                          profile.label === "Conservative"
                            ? "Бага эрсдэл"
                            : profile.label === "Balanced"
                              ? "Тэнцвэртэй"
                              : "Өндөр эрсдэл",
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {tr(
                          profile.description,
                          profile.label === "Conservative"
                            ? "Эрсдэл бага, тогтвортой өгөөж"
                            : profile.label === "Balanced"
                              ? "Дунд эрсдэл/өгөөж"
                              : "Эрсдэл өндөр, боломж өндөр",
                        )}
                      </p>
                    </div>
                    {selectedProfile === profile.id && (
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    )}
                  </button>
                ))}
              </div>

              {/* Risk Tolerance Slider */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">
                    {t("Risk Tolerance", "Эрсдэлийн хүлцэл")}
                  </label>
                  <span className="text-sm text-muted-foreground">
                    {riskTolerance[0]}%
                  </span>
                </div>
                <Slider
                  value={riskTolerance}
                  onValueChange={setRiskTolerance}
                  max={100}
                  step={5}
                  className="py-2"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{t("Conservative", "Бага эрсдэл")}</span>
                  <span>{t("Aggressive", "Өндөр эрсдэл")}</span>
                </div>
              </div>

              {/* Auto Rebalance */}
              <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t("Auto-Rebalance", "Автомат дахин тэнцвэржүүлэх")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "Weekly automatic adjustments",
                      "7 хоног бүр автомат тохируулга",
                    )}
                  </p>
                </div>
                <Switch
                  checked={autoRebalance}
                  onCheckedChange={setAutoRebalance}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* AI Recommendations */}
        <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              {t("AI Recommendations", "AI зөвлөмжүүд")}
            </CardTitle>
            <CardDescription>
              {t(
                "Actionable suggestions to optimize your portfolio",
                "Багцаа оновчлох хэрэгжүүлэх зөвлөмжүүд",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {visibleRecommendations.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  {t(
                    "No recommendations — portfolio is already optimized for this profile.",
                    "Зөвлөмж байхгүй — багц энэ профайлд аль хэдийн оновчлогдсон.",
                  )}
                </div>
              ) : (
                visibleRecommendations.map((rec, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between",
                      rec.priority === "high" &&
                        "border-warning/50 bg-warning/5",
                      rec.priority === "medium" &&
                        "border-border/50 bg-secondary/30",
                      rec.priority === "low" &&
                        "border-border/50 bg-secondary/20",
                    )}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                          rec.type === "add" && "bg-success/20",
                          rec.type === "reduce" && "bg-destructive/20",
                          rec.type === "rebalance" && "bg-primary/20",
                          rec.type === "remove" && "bg-muted",
                        )}
                      >
                        {rec.type === "add" && (
                          <ArrowUpRight className="h-5 w-5 text-success" />
                        )}
                        {rec.type === "reduce" && (
                          <ArrowDownRight className="h-5 w-5 text-destructive" />
                        )}
                        {rec.type === "rebalance" && (
                          <RefreshCw className="h-5 w-5 text-primary" />
                        )}
                        {rec.type === "remove" && (
                          <Minus className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-foreground">
                            {rec.symbol}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-[10px] capitalize"
                          >
                            {rec.type}
                          </Badge>
                          <Badge
                            variant={
                              rec.priority === "high" ? "default" : "secondary"
                            }
                            className={cn(
                              "text-[10px]",
                              rec.priority === "high" &&
                                "bg-warning text-warning-foreground",
                            )}
                          >
                            {rec.priority} priority
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {tr(
                            rec.reason,
                            rec.symbol === "BTC"
                              ? "BTC-ийн хуваарилалт эрсдэлийн оновчтой түвшнээс давсан. Exposure бууруулснаар өгөөж алдахгүйгээр төрөлжилт сайжирна."
                              : rec.symbol === "ETH"
                                ? "ETH суурь үзүүлэлт хүчтэй, L2 өсөлт нэмэгдэж байна. Хуваарилалт нэмэх нь боломжийг ашиглана."
                                : rec.symbol === "SOL"
                                  ? "SOL momentum өндөр тул илүү сайн гүйцэтгэлтэй байх магадлалтай. Бага хэмжээгээр нэмэх нь тохиромжтой."
                                  : "Одоогийн зах дээр meme coin-оос зайлсхийх нь зүйтэй. Суурь дэмжлэг багатай өндөр савлагаа эрсдэлийг өсгөнө.",
                          )}
                        </p>
                        <div className="mt-2 flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">
                            {rec.currentAllocation}%
                          </span>
                          <ArrowRight className="h-3 w-3 text-primary" />
                          <span className="font-bold text-foreground">
                            {rec.suggestedAllocation}%
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDismissRecommendation(rec)}
                      >
                        {t("Dismiss", "Хаах")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleApplyRecommendation(rec)}
                        disabled={appliedSymbols.has(rec.symbol)}
                        className="shrink-0"
                      >
                        {appliedSymbols.has(rec.symbol)
                          ? t("Applied", "Хэрэгжсэн")
                          : t("Apply", "Хэрэгжүүлэх")}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {visibleRecommendations.length > 0 && (
              <div className="mt-6 flex justify-end gap-2">
                <Button variant="outline" onClick={handleDismissAll}>
                  {t("Dismiss All", "Бүгдийг хаах")}
                </Button>
                <Button className="bg-primary" onClick={handleApplyAll}>
                  {t("Apply All Recommendations", "Бүх зөвлөмжийг хэрэгжүүлэх")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Summary */}
        <Card className="mt-6 border-primary/30 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="font-medium text-foreground">
                  {t("AI Portfolio Summary", "AI багцын дүгнэлт")}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tr(
                    selectedProfile === "conservative"
                      ? `Your portfolio is over-concentrated in BTC (65.9%). The conservative optimization reduces volatility by increasing stablecoin holdings to ${optimization.alloc.stables}% while maintaining BTC at ${optimization.alloc.btc}%. Expected risk-adjusted return improvement: +${optimization.expectedReturn}%.`
                      : selectedProfile === "aggressive"
                        ? `Aggressive optimization maximizes growth potential by increasing SOL to ${optimization.alloc.sol}% and reducing BTC to ${optimization.alloc.btc}%. Higher risk tolerance (score: ${optimization.optimizedRisk}) enables capturing altcoin momentum for an expected +${optimization.expectedReturn}% return improvement.`
                        : `Your portfolio is currently over-concentrated in BTC (65.9%), which increases single-asset risk. The balanced allocation reduces BTC to ${optimization.alloc.btc}% and increases ETH (${optimization.alloc.eth}%) and SOL (${optimization.alloc.sol}%) to capture altcoin momentum. This could improve risk-adjusted returns by approximately +${optimization.expectedReturn}%.`,
                    selectedProfile === "conservative"
                      ? `Таны багц BTC дээр хэт төвлөрсөн (65.9%). Бага эрсдэлтэй оновчлол нь stablecoin-ийг ${optimization.alloc.stables}% хүртэл нэмж, BTC-г ${optimization.alloc.btc}%-д хадгалснаар савлагааг бууруулна. Хүлээгдэж буй өгөөжийн сайжруулалт: +${optimization.expectedReturn}%.`
                      : selectedProfile === "aggressive"
                        ? `Өндөр эрсдэлтэй оновчлол нь SOL-ыг ${optimization.alloc.sol}% хүртэл нэмж, BTC-г ${optimization.alloc.btc}% хүртэл бууруулснаар өсөлтийн боломжийг нэмэгдүүлнэ. Хүлээгдэж буй өгөөжийн сайжруулалт: +${optimization.expectedReturn}%.`
                        : `Таны багц BTC дээр хэт төвлөрсөн (65.9%). Тэнцвэртэй хуваарилалт нь BTC-г ${optimization.alloc.btc}% хүртэл бууруулж, ETH (${optimization.alloc.eth}%) болон SOL (${optimization.alloc.sol}%)-г нэмснээр эрсдэлд тохируулсан өгөөжийг +${optimization.expectedReturn}%-аар сайжруулна.`,
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
