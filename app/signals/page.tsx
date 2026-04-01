"use client";

import { useMemo, useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { SignalCard } from "@/components/signals/signal-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Target,
  TrendingUp,
  TrendingDown,
  Zap,
  Filter,
  Bell,
  RefreshCw,
  ArrowUpDown,
  BarChart2,
  Bot,
  CheckCircle,
  Activity,
} from "lucide-react";
import type { AITradeSignal } from "@/lib/types";
import { useSignalsData } from "@/hooks/use-dashboard-data";
import { toast } from "sonner";

type SignalActionType = "demo" | "execute";

interface SignalActionState {
  type: SignalActionType;
  at: number;
}

export default function SignalsPage() {
  const { signals, isLoading, source, refresh } = useSignalsData();
  const [filter, setFilter] = useState<"all" | "buy" | "sell" | "hold">("all");
  const [sortBy, setSortBy] = useState<"confidence" | "risk">("confidence");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionStateBySignal, setActionStateBySignal] = useState<
    Record<string, SignalActionState>
  >({});
  const [openSignalIds, setOpenSignalIds] = useState<Set<string>>(new Set());
  const [autoMode, setAutoMode] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-execute high-confidence BUY signals when auto mode is enabled
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!autoMode || !mounted) return;
    const candidates = signals.filter(
      (s) =>
        (s.signalType === "BUY" || s.signalType === "STRONG_BUY") &&
        s.confidence >= 75 &&
        !openSignalIds.has(s.id),
    );
    if (candidates.length === 0) return;
    const timers = candidates.map((signal, i) =>
      setTimeout(() => {
        setActionStateBySignal((prev) => ({
          ...prev,
          [signal.id]: { type: "demo", at: Date.now() },
        }));
        setOpenSignalIds((prev) => new Set([...prev, signal.id]));
        toast.success(`🤖 AI auto-bought ${signal.symbol}`, {
          description: `Paper trade placed • Entry $${signal.entryPrice.toLocaleString()} • Confidence ${signal.confidence}%`,
        });
      }, i * 900),
    );
    return () => timers.forEach(clearTimeout);
  }, [autoMode, signals]);

  const persistActionState = (next: Record<string, SignalActionState>) => {
    setActionStateBySignal(next);
  };

  const markSignalExecuted = (signalId: string, type: SignalActionType) => {
    persistActionState({
      ...actionStateBySignal,
      [signalId]: {
        type,
        at: Date.now(),
      },
    });
  };

  const recentActionBySignal = useMemo(() => {
    const now = Date.now();
    const result: Record<string, SignalActionType | null> = {};

    for (const [signalId, action] of Object.entries(actionStateBySignal)) {
      result[signalId] = now - action.at <= 45_000 ? action.type : null;
    }

    return result;
  }, [actionStateBySignal]);

  const getRiskRank = (signal: AITradeSignal) => {
    if (signal.riskScore <= 35) return 1;
    if (signal.riskScore <= 62) return 2;
    return 3;
  };

  const filteredSignals = signals
    .filter((signal) => {
      if (filter === "all") return true;
      if (filter === "buy") {
        return (
          signal.signalType === "BUY" || signal.signalType === "STRONG_BUY"
        );
      }
      if (filter === "sell") {
        return (
          signal.signalType === "SELL" || signal.signalType === "STRONG_SELL"
        );
      }
      if (filter === "hold") return signal.signalType === "HOLD";
      return true;
    })
    .sort((a, b) => {
      const direction = sortOrder === "asc" ? 1 : -1;
      if (sortBy === "confidence") {
        return (a.confidence - b.confidence) * direction;
      }
      return (getRiskRank(a) - getRiskRank(b)) * direction;
    });

  const handleTrade = (signal: AITradeSignal, action: "execute" | "demo") => {
    const isExecutableSignal =
      signal.signalType.includes("BUY") || signal.signalType.includes("SELL");

    if (action === "demo") {
      markSignalExecuted(signal.id, "demo");
      setOpenSignalIds((prev) => new Set([...prev, signal.id]));
      toast.success(`Bought ${signal.symbol} in Demo`, {
        description: `Paper execution only: Entry $${signal.entryPrice.toLocaleString()} | SL $${signal.stopLoss.toLocaleString()} | Open position created`,
      });
      return;
    }

    if (isExecutableSignal) {
      markSignalExecuted(signal.id, "execute");
      setOpenSignalIds((prev) => new Set([...prev, signal.id]));
      toast.success(`${signal.symbol} order executed (Paper)`, {
        description: `Not live exchange. Size: $${(signal.entryPrice * 100).toFixed(0)}`,
      });
      return;
    }

    toast.info("No direct order on HOLD", {
      description: "Review active paper trades in the Demo section.",
    });
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
    toast.success("Signals refreshed!", {
      description: "Live AI signals recomputed from market data.",
    });
  };

  const buySignals = signals.filter(
    (s) => s.signalType === "BUY" || s.signalType === "STRONG_BUY",
  );
  const sellSignals = signals.filter(
    (s) => s.signalType === "SELL" || s.signalType === "STRONG_SELL",
  );
  const holdSignals = signals.filter((s) => s.signalType === "HOLD");

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 md:px-6 lg:py-8">
        <div className="mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="flex items-center gap-3 text-2xl font-bold text-foreground md:text-3xl">
                <Target className="h-7 w-7 text-primary" />
                AI Trade Signals
              </h1>
              <p className="mt-1 text-muted-foreground">
                Clear buy, sell, and hold recommendations powered by AI analysis
              </p>
              <p className="mt-2 text-xs text-primary">
                Execute/Buy on this page always opens PAPER (demo) trades only.
              </p>
              {source === "live" ? (
                <p className="mt-1 text-xs text-green-500">
                  ● Live data from CoinGecko · refreshes every 2 min
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  ● Fallback data · check network
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => toast.info("Notifications enabled")}
              >
                <Bell className="mr-2 h-4 w-4" />
                Alerts
              </Button>
              <Button size="sm" onClick={handleRefresh} disabled={isRefreshing}>
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* AI Automation Mode Panel */}
        <Card className="mb-8 border-border/50 bg-card/60 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-5 w-5 text-primary" />
                AI Automation Mode
                <Badge
                  variant={autoMode ? "default" : "secondary"}
                  className="ml-1 text-[10px]"
                >
                  {autoMode ? "ACTIVE" : "INACTIVE"}
                </Badge>
              </CardTitle>
              {mounted && (
                <Switch
                  checked={autoMode}
                  onCheckedChange={(val) => {
                    setAutoMode(val);
                    toast.info(
                      val ? "AI Auto Mode Enabled" : "AI Auto Mode Disabled",
                      {
                        description: val
                          ? "AI will auto paper-trade BUY signals with confidence ≥ 75%."
                          : "You are now in manual mode.",
                      },
                    );
                  }}
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              When active, AI automatically places paper trades on BUY signals
              with confidence ≥ 75%. No real funds are used.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                  <p className="text-[11px] text-muted-foreground">
                    Min Confidence
                  </p>
                  <p className="mt-0.5 font-semibold text-foreground">75%</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                  <p className="text-[11px] text-muted-foreground">
                    Trade Type
                  </p>
                  <p className="mt-0.5 font-semibold text-foreground">
                    Paper Only
                  </p>
                </div>
                <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                  <p className="text-[11px] text-muted-foreground">Eligible</p>
                  <p
                    className={`mt-0.5 font-semibold ${
                      autoMode ? "text-green-500" : "text-muted-foreground"
                    }`}
                  >
                    {
                      signals.filter(
                        (s) =>
                          (s.signalType === "BUY" ||
                            s.signalType === "STRONG_BUY") &&
                          s.confidence >= 75,
                      ).length
                    }{" "}
                    signals
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Activity className="h-3.5 w-3.5" />
                  Recent AI Executions
                </p>
                {Object.keys(actionStateBySignal).length === 0 ? (
                  <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border/50 text-xs text-muted-foreground">
                    No trades executed yet — enable Auto Mode or click Buy/Demo
                  </div>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(actionStateBySignal)
                      .sort((a, b) => b[1].at - a[1].at)
                      .slice(0, 4)
                      .map(([signalId, action]) => {
                        const signal = signals.find((s) => s.id === signalId);
                        if (!signal) return null;
                        const elapsed = Math.floor(
                          (Date.now() - action.at) / 1000,
                        );
                        const timeLabel =
                          elapsed < 60
                            ? `${elapsed}s ago`
                            : `${Math.floor(elapsed / 60)}m ago`;
                        return (
                          <div
                            key={signalId}
                            className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                              <span className="font-semibold text-foreground">
                                {signal.symbol}
                              </span>
                              <Badge variant="outline" className="text-[9px]">
                                {action.type === "demo" ? "Demo" : "Paper"}
                              </Badge>
                              <span className="text-muted-foreground">
                                ${signal.entryPrice.toLocaleString()}
                              </span>
                            </div>
                            <span className="text-muted-foreground">
                              {timeLabel}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="mb-8 grid gap-4 md:grid-cols-5">
          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Active Signals
                  </p>
                  <p className="mt-1 text-2xl font-bold text-foreground">
                    {signals.length}
                  </p>
                </div>
                <div className="rounded-lg bg-primary/20 p-3">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Buy Signals</p>
                  <p className="mt-1 text-2xl font-bold text-green-500">
                    {buySignals.length}
                  </p>
                </div>
                <div className="rounded-lg bg-green-500/20 p-3">
                  <TrendingUp className="h-5 w-5 text-green-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Sell Signals</p>
                  <p className="mt-1 text-2xl font-bold text-red-500">
                    {sellSignals.length}
                  </p>
                </div>
                <div className="rounded-lg bg-red-500/20 p-3">
                  <TrendingDown className="h-5 w-5 text-red-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Avg Confidence
                  </p>
                  <p className="mt-1 text-2xl font-bold text-foreground">
                    {Math.round(
                      signals.length > 0
                        ? signals.reduce((a, b) => a + b.confidence, 0) /
                            signals.length
                        : 0,
                    )}
                    %
                  </p>
                </div>
                <div className="rounded-lg bg-blue-500/20 p-3">
                  <Target className="h-5 w-5 text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardContent className="pt-6">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Market Bias</p>
                <div className="rounded-lg bg-primary/20 p-2">
                  <BarChart2 className="h-4 w-4 text-primary" />
                </div>
              </div>
              {signals.length > 0 ? (
                <>
                  <div className="mb-2 flex h-3 overflow-hidden rounded-full">
                    {buySignals.length > 0 && (
                      <div
                        className="bg-green-500"
                        style={{
                          width: `${(buySignals.length / signals.length) * 100}%`,
                        }}
                      />
                    )}
                    {holdSignals.length > 0 && (
                      <div
                        className="bg-muted-foreground/50"
                        style={{
                          width: `${(holdSignals.length / signals.length) * 100}%`,
                        }}
                      />
                    )}
                    {sellSignals.length > 0 && (
                      <div
                        className="bg-red-500"
                        style={{
                          width: `${(sellSignals.length / signals.length) * 100}%`,
                        }}
                      />
                    )}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span className="text-green-500">
                      {Math.round((buySignals.length / signals.length) * 100)}%
                      Buy
                    </span>
                    <span className="text-red-500">
                      {Math.round((sellSignals.length / signals.length) * 100)}%
                      Sell
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">-</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as typeof filter)}
          className="mb-6"
        >
          <TabsList className="bg-secondary/50">
            <TabsTrigger
              value="all"
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              All ({signals.length})
            </TabsTrigger>
            <TabsTrigger
              value="buy"
              className="data-[state=active]:bg-green-500 data-[state=active]:text-white"
            >
              Buy ({buySignals.length})
            </TabsTrigger>
            <TabsTrigger
              value="sell"
              className="data-[state=active]:bg-red-500 data-[state=active]:text-white"
            >
              Sell ({sellSignals.length})
            </TabsTrigger>
            <TabsTrigger
              value="hold"
              className="data-[state=active]:bg-muted data-[state=active]:text-foreground"
            >
              Hold ({holdSignals.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-card/60 p-3 backdrop-blur-sm">
          <span className="text-xs text-muted-foreground">Sort by</span>
          <Button
            size="sm"
            variant={sortBy === "confidence" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setSortBy("confidence")}
          >
            Confidence
          </Button>
          <Button
            size="sm"
            variant={sortBy === "risk" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setSortBy("risk")}
          >
            Risk
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() =>
              setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))
            }
          >
            <ArrowUpDown className="mr-1 h-3 w-3" />
            {sortOrder === "desc" ? "High to Low" : "Low to High"}
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {filteredSignals.map((signal) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              onTrade={handleTrade}
              isBought={openSignalIds.has(signal.id)}
              recentAction={recentActionBySignal[signal.id] ?? null}
            />
          ))}
        </div>

        {filteredSignals.length === 0 && (
          <Card className="border-border/50 bg-card/60 py-12 text-center backdrop-blur-sm">
            <CardContent>
              <Filter className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-lg font-medium text-foreground">
                No signals found
              </p>
              <p className="text-muted-foreground">
                Try a different filter or refresh.
              </p>
            </CardContent>
          </Card>
        )}

        <Card className="mt-8 border-border/50 bg-card/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Zap className="h-5 w-5 text-primary" />
              How AI Signals Work
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-3">
              <div>
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  1
                </div>
                <h4 className="font-semibold text-foreground">Data Analysis</h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  AI analyzes price action, volume, on-chain data, social
                  sentiment, and technical indicators in real-time.
                </p>
              </div>
              <div>
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  2
                </div>
                <h4 className="font-semibold text-foreground">
                  Signal Generation
                </h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  When patterns emerge, AI generates clear BUY/SELL/HOLD signals
                  with entry, stop-loss, and take-profit levels.
                </p>
              </div>
              <div>
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  3
                </div>
                <h4 className="font-semibold text-foreground">
                  Track & Execute
                </h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  Test signals risk-free in your Demo Account, or execute
                  manually on your preferred exchange.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
