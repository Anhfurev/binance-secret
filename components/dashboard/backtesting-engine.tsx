"use client";

import { useEffect, useMemo, useState } from "react";
import { Beaker, PlayCircle, Sigma } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AITradeSignal, CoinData } from "@/lib/types";
import { useLanguage } from "@/components/language-provider";

interface BacktestingEngineProps {
  coins: CoinData[];
  aiSignals: AITradeSignal[];
}

type BacktestMode = "ai" | "custom";
type Direction = "long" | "short";

interface CustomStrategyConfig {
  name?: string;
  market?: string;
  minSignalConfidence?: number;
  allowLong?: boolean;
  allowShort?: boolean;
  useRsi?: boolean;
  useMacd?: boolean;
  useMovingAverage?: boolean;
  useVolumeSpike?: boolean;
  rsiOversold?: number;
  rsiOverbought?: number;
  maxPositionSize?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
}

interface SavedStrategy {
  id: string;
  createdAt: string;
  config: CustomStrategyConfig;
}

interface BacktestResult {
  totalProfit: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
  totalTrades: number;
  endingBalance: number;
}

interface Position {
  direction: Direction;
  entryPrice: number;
  stopPrice: number;
  takePrice: number;
  openedAt: number;
}

const STRATEGY_BUILDER_STORAGE_KEY = "nextrade-custom-strategies";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function computeSma(prices: number[], period: number) {
  const sma = new Array<number | null>(prices.length).fill(null);
  for (let i = period - 1; i < prices.length; i += 1) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j += 1) sum += prices[j];
    sma[i] = sum / period;
  }
  return sma;
}

function computeRsi(prices: number[], period = 14) {
  const rsi = new Array<number | null>(prices.length).fill(null);
  if (prices.length <= period) return rsi;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < prices.length; i += 1) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return rsi;
}

function calcMaxDrawdown(equity: number[]) {
  if (equity.length === 0) return 0;
  let peak = equity[0];
  let maxDd = 0;

  for (const value of equity) {
    if (value > peak) peak = value;
    const dd = ((peak - value) / peak) * 100;
    if (dd > maxDd) maxDd = dd;
  }

  return maxDd;
}

function calcSharpe(stepReturns: number[]) {
  if (stepReturns.length < 2) return 0;
  const mean =
    stepReturns.reduce((sum, val) => sum + val, 0) / stepReturns.length;
  const variance =
    stepReturns.reduce((sum, val) => sum + (val - mean) ** 2, 0) /
    (stepReturns.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev < 1e-9) return 0;
  return (mean / stdDev) * Math.sqrt(252);
}

function getDirectionFromSignal(signal?: AITradeSignal): Direction | null {
  if (!signal) return null;
  if (signal.signalType.includes("BUY")) return "long";
  if (signal.signalType.includes("SELL")) return "short";
  return null;
}

function runBacktest(params: {
  prices: number[];
  initialCapital: number;
  mode: BacktestMode;
  aiSignal?: AITradeSignal;
  customStrategy?: CustomStrategyConfig;
}) {
  const { prices, initialCapital, mode, aiSignal, customStrategy } = params;
  if (prices.length < 80) return null;

  const rsi14 = computeRsi(prices, 14);
  const sma12 = computeSma(prices, 12);
  const sma26 = computeSma(prices, 26);
  const sma20 = computeSma(prices, 20);
  const sma50 = computeSma(prices, 50);

  let equity = initialCapital;
  const equityCurve: number[] = [equity];
  const stepReturns: number[] = [];
  let wins = 0;
  let trades = 0;
  let open: Position | null = null;

  const custom = {
    minSignalConfidence: customStrategy?.minSignalConfidence ?? 60,
    allowLong: customStrategy?.allowLong ?? true,
    allowShort: customStrategy?.allowShort ?? false,
    useRsi: customStrategy?.useRsi ?? true,
    useMacd: customStrategy?.useMacd ?? true,
    useMovingAverage: customStrategy?.useMovingAverage ?? true,
    useVolumeSpike: customStrategy?.useVolumeSpike ?? false,
    rsiOversold: customStrategy?.rsiOversold ?? 32,
    rsiOverbought: customStrategy?.rsiOverbought ?? 68,
    stopLossPct: customStrategy?.stopLossPct ?? 3,
    takeProfitPct: customStrategy?.takeProfitPct ?? 7,
  };

  const aiDirection = getDirectionFromSignal(aiSignal);
  const aiConfidence = aiSignal?.confidence ?? 0;
  const aiStopPct = aiSignal
    ? Math.max(
        0.6,
        (Math.abs(aiSignal.entryPrice - aiSignal.stopLoss) /
          aiSignal.entryPrice) *
          100,
      )
    : 3;
  const aiTakePct = aiSignal?.takeProfits?.[0]
    ? Math.max(
        1,
        (Math.abs(aiSignal.takeProfits[0].price - aiSignal.entryPrice) /
          aiSignal.entryPrice) *
          100,
      )
    : 6;

  for (let i = 50; i < prices.length; i += 1) {
    const price = prices[i];
    const prevPrice = prices[i - 1];

    if (open) {
      const long = open.direction === "long";
      const pnlRatio = long
        ? (price - open.entryPrice) / open.entryPrice
        : (open.entryPrice - price) / open.entryPrice;
      const stopHit = long ? price <= open.stopPrice : price >= open.stopPrice;
      const takeHit = long ? price >= open.takePrice : price <= open.takePrice;
      const timeout = i - open.openedAt >= 24;

      if (stopHit || takeHit || timeout || i === prices.length - 1) {
        equity *= 1 + pnlRatio;
        trades += 1;
        if (pnlRatio > 0) wins += 1;
        stepReturns.push(pnlRatio);
        equityCurve.push(equity);
        open = null;
      }
    } else {
      const rsi = rsi14[i];
      const macdBull = (sma12[i] ?? 0) > (sma26[i] ?? 0);
      const macdBear = (sma12[i] ?? 0) < (sma26[i] ?? 0);
      const trendBull = (sma20[i] ?? 0) > (sma50[i] ?? 0);
      const trendBear = (sma20[i] ?? 0) < (sma50[i] ?? 0);
      const oneStepMove = Math.abs((price - prevPrice) / prevPrice);
      const avgMove = Math.abs(
        (prices[i - 10] - prices[i - 11]) / prices[i - 11],
      );
      const volumeSpikeProxy = oneStepMove > avgMove * 1.3;

      let direction: Direction | null = null;
      let stopPct = 3;
      let takePct = 6;

      if (mode === "ai") {
        if (aiDirection && aiConfidence >= 55) {
          const directionalFilter =
            (aiDirection === "long" && (trendBull || (rsi ?? 50) < 48)) ||
            (aiDirection === "short" && (trendBear || (rsi ?? 50) > 52));
          if (directionalFilter) direction = aiDirection;
          stopPct = aiStopPct;
          takePct = aiTakePct;
        }
      } else {
        const longOk =
          custom.allowLong &&
          (!custom.useRsi || (rsi ?? 50) <= custom.rsiOversold) &&
          (!custom.useMacd || macdBull) &&
          (!custom.useMovingAverage || trendBull) &&
          (!custom.useVolumeSpike || volumeSpikeProxy);

        const shortOk =
          custom.allowShort &&
          (!custom.useRsi || (rsi ?? 50) >= custom.rsiOverbought) &&
          (!custom.useMacd || macdBear) &&
          (!custom.useMovingAverage || trendBear) &&
          (!custom.useVolumeSpike || volumeSpikeProxy);

        if (longOk) direction = "long";
        else if (shortOk) direction = "short";

        const confidenceProxy = clamp(
          50 + (Math.abs((rsi ?? 50) - 50) + (trendBull || trendBear ? 10 : 0)),
          0,
          100,
        );

        if (confidenceProxy < custom.minSignalConfidence) direction = null;
        stopPct = custom.stopLossPct;
        takePct = custom.takeProfitPct;
      }

      if (direction) {
        open = {
          direction,
          entryPrice: price,
          stopPrice:
            direction === "long"
              ? price * (1 - stopPct / 100)
              : price * (1 + stopPct / 100),
          takePrice:
            direction === "long"
              ? price * (1 + takePct / 100)
              : price * (1 - takePct / 100),
          openedAt: i,
        };
      }
    }

    equityCurve.push(equity);
  }

  const totalProfit = equity - initialCapital;
  return {
    totalProfit,
    winRate: trades > 0 ? (wins / trades) * 100 : 0,
    maxDrawdown: calcMaxDrawdown(equityCurve),
    sharpeRatio: calcSharpe(stepReturns),
    totalTrades: trades,
    endingBalance: equity,
  } satisfies BacktestResult;
}

function formatUsd(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function BacktestingEngine({
  coins,
  aiSignals,
}: BacktestingEngineProps) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<BacktestMode>("ai");
  const [selectedCoinId, setSelectedCoinId] = useState<string>(
    coins[0]?.id ?? "",
  );
  const [initialCapital, setInitialCapital] = useState<number>(10000);
  const [lookbackDays, setLookbackDays] = useState<string>("30");
  const [savedStrategies, setSavedStrategies] = useState<SavedStrategy[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>("");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (coins.length > 0 && !selectedCoinId) {
      setSelectedCoinId(coins[0].id);
    }
  }, [coins, selectedCoinId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const load = () => {
      try {
        const raw = window.localStorage.getItem(STRATEGY_BUILDER_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as SavedStrategy[]) : [];
        const strategies = Array.isArray(parsed) ? parsed : [];
        setSavedStrategies(strategies);
        if (!selectedStrategyId && strategies.length > 0) {
          setSelectedStrategyId(strategies[0].id);
        }
      } catch {
        setSavedStrategies([]);
      }
    };

    load();
    window.addEventListener("storage", load);
    return () => window.removeEventListener("storage", load);
  }, [selectedStrategyId]);

  const selectedCoin = useMemo(
    () => coins.find((coin) => coin.id === selectedCoinId),
    [coins, selectedCoinId],
  );

  const selectedSignal = useMemo(() => {
    if (!selectedCoin) return aiSignals[0];
    return (
      aiSignals.find(
        (signal) =>
          signal.coinId === selectedCoin.id ||
          signal.symbol.toLowerCase() === selectedCoin.symbol.toLowerCase(),
      ) ?? aiSignals[0]
    );
  }, [aiSignals, selectedCoin]);

  const selectedCustomStrategy = useMemo(
    () =>
      savedStrategies.find((item) => item.id === selectedStrategyId)?.config,
    [savedStrategies, selectedStrategyId],
  );

  const run = async () => {
    if (!selectedCoin) return;

    setIsRunning(true);
    setError(null);

    try {
      const url = `https://api.coingecko.com/api/v3/coins/${selectedCoin.id}/market_chart?vs_currency=usd&days=${lookbackDays}&interval=hourly`;
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Market data fetch failed (${response.status})`);

      const payload = (await response.json()) as {
        prices?: [number, number][];
      };

      const prices = (payload.prices ?? [])
        .map((item) => item[1])
        .filter(Boolean);
      const backtest = runBacktest({
        prices,
        initialCapital,
        mode,
        aiSignal: selectedSignal,
        customStrategy: selectedCustomStrategy,
      });

      if (!backtest) {
        throw new Error("Not enough historical data to run backtest.");
      }

      setResult(backtest);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Backtest failed";
      setError(message);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card className="border-border/60 bg-card/70 backdrop-blur-sm lg:col-span-12">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Beaker className="h-4 w-4 text-primary" />
          {t("Backtesting Engine", "Backtesting хөдөлгүүр")}
          <Badge variant="outline" className="text-[10px]">
            {t("Historical Simulation", "Түүхэн симуляци")}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-5">
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">
              {t("Mode", "Горим")}
            </p>
            <Select
              value={mode}
              onValueChange={(value) => setMode(value as BacktestMode)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ai">
                  {t("AI Signal Backtest", "AI дохио backtest")}
                </SelectItem>
                <SelectItem value="custom">
                  {t("Custom Strategy Backtest", "Custom стратеги backtest")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">
              {t("Asset", "Хөрөнгө")}
            </p>
            <Select value={selectedCoinId} onValueChange={setSelectedCoinId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {coins.map((coin) => (
                  <SelectItem key={coin.id} value={coin.id}>
                    {coin.symbol.toUpperCase()} ({coin.name})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">
              {t("Initial Capital", "Эхний капитал")}
            </p>
            <Input
              type="number"
              min={100}
              step={100}
              value={initialCapital}
              onChange={(event) =>
                setInitialCapital(
                  Math.max(100, Number(event.target.value) || 100),
                )
              }
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">
              {t("Lookback", "Түүхэн хугацаа")}
            </p>
            <Select value={lookbackDays} onValueChange={setLookbackDays}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7d</SelectItem>
                <SelectItem value="30">30d</SelectItem>
                <SelectItem value="90">90d</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end">
            <Button
              className="w-full gap-1"
              onClick={run}
              disabled={isRunning || !selectedCoinId}
            >
              <PlayCircle className="h-4 w-4" />
              {isRunning
                ? t("Running...", "Тооцоолж байна...")
                : t("Run Backtest", "Backtest ажиллуулах")}
            </Button>
          </div>
        </div>

        {mode === "custom" && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">
              {t("Custom Strategy", "Custom стратеги")}
            </p>
            <Select
              value={selectedStrategyId}
              onValueChange={setSelectedStrategyId}
            >
              <SelectTrigger className="w-full md:w-90">
                <SelectValue
                  placeholder={t("Select strategy", "Стратеги сонгох")}
                />
              </SelectTrigger>
              <SelectContent>
                {savedStrategies.length === 0 ? (
                  <SelectItem value="none" disabled>
                    {t("No saved strategy found", "Хадгалсан стратеги алга")}
                  </SelectItem>
                ) : (
                  savedStrategies.map((strategy) => (
                    <SelectItem key={strategy.id} value={strategy.id}>
                      {strategy.config.name || strategy.id}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {result && (
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
              <p className="text-[11px] text-muted-foreground">
                {t("Total Profit", "Нийт ашиг")}
              </p>
              <p
                className={
                  result.totalProfit >= 0
                    ? "text-lg font-semibold text-success"
                    : "text-lg font-semibold text-destructive"
                }
              >
                {result.totalProfit >= 0 ? "+" : ""}
                {formatUsd(result.totalProfit)}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
              <p className="text-[11px] text-muted-foreground">
                {t("Win Rate", "Ялалтын хувь")}
              </p>
              <p className="text-lg font-semibold text-foreground">
                {result.winRate.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
              <p className="text-[11px] text-muted-foreground">
                {t("Maximum Drawdown", "Хамгийн их drawdown")}
              </p>
              <p className="text-lg font-semibold text-foreground">
                -{result.maxDrawdown.toFixed(2)}%
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
              <p className="text-[11px] text-muted-foreground">Sharpe Ratio</p>
              <p className="text-lg font-semibold text-foreground">
                {result.sharpeRatio.toFixed(2)}
              </p>
            </div>

            <div className="rounded-lg border border-border/60 bg-secondary/20 p-3 md:col-span-4">
              <p className="text-[11px] text-muted-foreground">
                {t("Trades", "Арилжаа")}: {result.totalTrades} ·{" "}
                {t("Ending Balance", "Эцсийн үлдэгдэл")}:{" "}
                {formatUsd(result.endingBalance)}
              </p>
            </div>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          <Sigma className="mr-1 inline h-3.5 w-3.5" />
          {t(
            "Backtests use historical market data and simplified execution assumptions. Use results as guidance, not guarantees.",
            "Backtest нь түүхэн өгөгдөл болон хялбарчилсан биелэлтийн загвар ашигладаг. Үр дүнг баталгаа биш, чиглэл гэж үзнэ үү.",
          )}
        </p>
      </CardContent>
    </Card>
  );
}
