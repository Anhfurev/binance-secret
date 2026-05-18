"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { AppLayout } from "@/components/layout/app-layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// Components
import { EquityCurve } from "./_components/equity-curve";
import { StatsGrid } from "./_components/stats-grid";
import { OpenPositionsTable } from "./_components/open-positions-table";
import { OpenPositionTrackers } from "./_components/open-position-trackers";
import { TradeHistoryTable } from "./_components/trade-history-table";
import { PageHeader } from "./_components/page-header";
import { AITradingMasterControl } from "./_components/ai-master-control";
import { TechnicalPulseCard } from "./_components/technical-pulse-card";

// Utils & Logic
import {
  useBinanceAccountStatus,
  useMarketData,
  useSignalsData,
} from "@/hooks/use-dashboard-data";
import { useAuth } from "@/components/auth-provider";
import { useAiStore } from "@/lib/store/ai-store";
import { filterActionableSignals } from "@/lib/crypto-utils";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { toAiReasoningSummary } from "@/lib/ai-reasoning";
import { computePortfolioNavUsd } from "@/lib/portfolio/nav";

type RecentActivityItem = {
  id: string;
  symbol: string;
  price: number;
  aiConfidence: number;
  createdAt: string;
};

type LatestStatusPayload = {
  ok?: boolean;
  status?: string | null;
  reason?: string | null;
  error?: string | null;
};

type TechnicalPulseItem = {
  id: string;
  createdAt: string;
  symbol: string;
  techScore: number | null;
  rsi: number | null;
  aiConfidence: number | null;
  note: string;
};

type BotPerformanceSummary = {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRatePct: number;
  totalPnlUsd: number;
};

type BotPerformancePayload = {
  ok?: boolean;
  summary?: BotPerformanceSummary | null;
};

export default function DemoPage() {
  const isDemo = true;
  // 1. Core State
  const [isHydrated, setIsHydrated] = useState(false);
  const [account, setAccount] = useState<any>(null);
  const {
    walletMode,
    setWalletMode,
    autoPilotEnabled: demoAutoPilot,
    setAutoPilotEnabled: setDemoAutoPilot,
    autoPilotMode,
    setAutoPilotMode,
    setTradeSignals,
    setProcessing,
  } = useAiStore();
  const [cloudSyncMessage, setCloudSyncMessage] = useState<string | null>(null);
  const [cloudSyncState, setCloudSyncState] = useState<any>("synced");
  const [lastCloudSync, setLastCloudSync] = useState<string | null>(null);
  const [resolvedBotUserId, setResolvedBotUserId] = useState<string | null>(null);
  const [realBalance, setRealBalance] = useState(0);
  const [realStartingBalance, setRealStartingBalance] = useState(0);
  const [isPnlSyncing, setIsPnlSyncing] = useState(false);
  const [balanceUpdatedAt, setBalanceUpdatedAt] = useState<string | null>(null);
  const [isBalanceResolved, setIsBalanceResolved] = useState(false);
  const [debugMessage, setDebugMessage] = useState<string | null>(null);
  const [syncNonce, setSyncNonce] = useState(0);
  const openPositionsSignatureRef = useRef("");
  const tradeHistorySignatureRef = useRef("");
  const lastSeenBalanceRef = useRef<number | null>(null);
  const { user, loading: authLoading } = useAuth();
  const effectiveWalletMode = isDemo ? walletMode : "real";

  // 2. Data Hooks
  const { signals: liveSignals } = useSignalsData();
  const { coins: marketCoins } = useMarketData();
  const { configured: binanceConfigured, apiError: binanceApiError } =
    useBinanceAccountStatus();
  const fetcher = (url: string) => fetch(url).then((res) => res.json());
  const { data: recentActivityData } = useSWR<{ activities?: RecentActivityItem[] }>(
    "/api/recent-activity",
    fetcher,
    { refreshInterval: 15000, revalidateOnFocus: false },
  );
  const { data: latestStatusData } = useSWR<LatestStatusPayload>(
    "/api/latest-status",
    fetcher,
    { refreshInterval: 15000, revalidateOnFocus: false },
  );
  const { data: technicalPulseData } = useSWR<{ traces?: TechnicalPulseItem[] }>(
    "/api/technical-pulse",
    fetcher,
    { refreshInterval: 15000, revalidateOnFocus: false },
  );
  const { data: botPerformanceData, mutate: mutateBotPerformance } = useSWR<BotPerformancePayload>(
    user?.id ? `/api/bot-performance?userId=${encodeURIComponent(user.id)}` : null,
    fetcher,
    { refreshInterval: 5000, revalidateOnFocus: true },
  );
  const { data: tradesData, isValidating: isTradesValidating, mutate: mutateTrades } = useSWR(
    user?.id && isSupabaseConfigured && supabase ? ["demo-trades", user.id] : null,
    async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("trades")
        .select(
          "id,symbol,type,status,price,entryPrice,exitPrice,amount,value,opened_at,closed_at,created_at,stopLoss,takeProfit,pnl,pnlPercent,ai_reasoning,followedSignal",
        )
        .eq("user_id", user?.id ?? "")
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    { refreshInterval: 3000, revalidateOnFocus: true },
  );
  const { data: openTradesData, mutate: mutateOpenTrades } = useSWR(
    user?.id && isSupabaseConfigured && supabase ? ["demo-open-trades", user.id] : null,
    async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("trades")
        .select(
          "id,symbol,type,status,price,entryPrice,amount,value,opened_at,created_at,stopLoss,takeProfit,pnl,pnlPercent,ai_reasoning,followedSignal",
        )
        .eq("user_id", user?.id ?? "")
        .ilike("status", "open")
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    { refreshInterval: 3000, revalidateOnFocus: true },
  );
  const recentActivities = recentActivityData?.activities ?? [];
  const technicalPulseTraces = technicalPulseData?.traces ?? [];
  const performanceSummary = botPerformanceData?.summary ?? null;
  const symbolToLivePrice = useMemo(
    () =>
      new Map(
        (marketCoins ?? []).map((coin) => [
          String(coin.symbol ?? "").toUpperCase(),
          Number(coin.current_price ?? 0),
        ]),
      ),
    [marketCoins],
  );
  const allTrades = useMemo(
    () => (Array.isArray(tradesData) ? tradesData : []),
    [tradesData],
  );
  const openTrades = useMemo(
    () => (Array.isArray(openTradesData) ? openTradesData : []),
    [openTradesData],
  );
  const closedTrades = useMemo(
    () =>
      allTrades.filter((trade: any) => {
        const status = String(trade.status ?? "").toLowerCase();
        return status === "closed" || status === "stopped" || status === "liquidated";
      }),
    [allTrades],
  );
  const normalizedOpenPositions = useMemo(
    () =>
      openTrades.map((trade: any) => {
        const symbol = String(trade.symbol ?? "UNKNOWN").toUpperCase();
        const symbolNoQuote = symbol.replace(/USDT$/, "");
        const livePrice = Number(
          symbolToLivePrice.get(symbolNoQuote) ??
            trade.price ??
            trade.entryPrice ??
            0,
        );
        const entryPrice = Number(trade.entryPrice ?? trade.price ?? 0);
        const amount = Number(trade.amount ?? 0);
        const unrealizedPnl = Number.isFinite(livePrice) &&
            Number.isFinite(entryPrice) &&
            Number.isFinite(amount)
          ? Number(((livePrice - entryPrice) * amount).toFixed(6))
          : 0;
        const baseValue = Number(trade.value ?? (entryPrice * amount) ?? 0);
        const unrealizedPnlPct = baseValue > 0
          ? Number(((unrealizedPnl / baseValue) * 100).toFixed(2))
          : 0;
        return {
            id: String(trade.id ?? `${trade.symbol}-${trade.opened_at ?? trade.created_at ?? Date.now()}`),
            signalId: String(trade.signalId ?? trade.id ?? `open-${Date.now()}`),
            coinId: String(trade.coinId ?? trade.symbol ?? "unknown"),
            symbol,
            type: String(trade.type ?? "buy"),
            status: String(trade.status ?? "open"),
            entryPrice,
            currentPrice: livePrice,
            amount,
            value: Number(trade.value ?? 0),
            openedAt: trade.opened_at ?? trade.created_at ?? new Date().toISOString(),
            stopLoss: Number(trade.stopLoss ?? 0),
            takeProfit: Number(trade.takeProfit ?? 0),
            pnl: unrealizedPnl,
            pnlPercent: unrealizedPnlPct,
            isFutures: false,
            followedSignal: Boolean(
              trade.followed_signal ?? trade.followedSignal ?? true,
            ),
            aiReasoning: toAiReasoningSummary(trade.ai_reasoning),
          };
      }),
    [openTrades, symbolToLivePrice],
  );
  const normalizedTradeHistory = useMemo(
    () =>
      closedTrades
        .map((trade: any) => ({
          id: String(trade.id ?? `${trade.symbol}-${trade.closed_at ?? trade.created_at ?? Date.now()}`),
          signalId: String(trade.signalId ?? trade.id ?? `history-${Date.now()}`),
          coinId: String(trade.coinId ?? trade.symbol ?? "unknown"),
          symbol: String(trade.symbol ?? "UNKNOWN"),
          type: String(trade.type ?? "sell"),
          entryPrice: Number(trade.entryPrice ?? trade.price ?? 0),
          exitPrice: Number(trade.exitPrice ?? trade.price ?? 0),
          amount: Number(trade.amount ?? 0),
          value: Number(trade.value ?? 0),
          status: String(trade.status ?? "closed"),
          pnl: Number(trade.pnl ?? 0),
          pnlPercent: Number(trade.pnlPercent ?? 0),
          openedAt: new Date(trade.opened_at ?? trade.created_at ?? Date.now()),
          closedAt: trade.closed_at ? new Date(trade.closed_at) : undefined,
          stopLoss: Number(trade.stopLoss ?? 0),
          takeProfit: Number(trade.takeProfit ?? 0),
          isFutures: false,
          followedSignal: Boolean(
            trade.followed_signal ?? trade.followedSignal ?? true,
          ),
          aiReasoning: toAiReasoningSummary(trade.ai_reasoning),
        }))
        .sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0)),
    [closedTrades],
  );
  const realizedClosedPnl = useMemo(
    () =>
      closedTrades.reduce((sum: number, trade: any) => {
        const pnl = Number(trade.pnl ?? 0);
        return Number.isFinite(pnl) ? sum + pnl : sum;
      }, 0),
    [closedTrades],
  );
  const unrealizedOpenPnl = useMemo(
    () =>
      normalizedOpenPositions.reduce(
        (sum: number, trade: any) => sum + Number(trade.pnl ?? 0),
        0,
      ),
    [normalizedOpenPositions],
  );
  const combinedTradePnl = useMemo(
    () => Number((realizedClosedPnl + unrealizedOpenPnl).toFixed(6)),
    [realizedClosedPnl, unrealizedOpenPnl],
  );
  const portfolioNav = useMemo(() => {
    const availableUsdt = Number.isFinite(realBalance) ? realBalance : 0;
    return computePortfolioNavUsd({
      availableUsdt,
      openPositions: normalizedOpenPositions.map((trade: any) => ({
        symbol: trade.symbol,
        amount: trade.amount,
        livePrice: trade.currentPrice,
        entryPrice: trade.entryPrice,
      })),
      priceBySymbol: symbolToLivePrice,
    }).navUsd;
  }, [normalizedOpenPositions, realBalance, symbolToLivePrice]);
  const openPositionsSignature = useMemo(
    () =>
      normalizedOpenPositions
        .map((trade: any) =>
          `${trade.id}:${trade.status}:${trade.entryPrice}:${trade.currentPrice}:${trade.pnl}:${trade.aiReasoning?.proTip ?? ""}:${trade.aiReasoning?.oneHBearishCapApplied ? 1 : 0}:${trade.aiReasoning?.rawWeightedConfidence ?? ""}:${trade.aiReasoning?.weightedPreSentimentVibe ?? ""}:${trade.aiReasoning?.effectiveConfidence ?? ""}`,
        )
        .join("|"),
    [normalizedOpenPositions],
  );
  const tradeHistorySignature = useMemo(
    () =>
      normalizedTradeHistory
        .map((trade: any) =>
          `${trade.id}:${trade.status}:${trade.entryPrice}:${trade.exitPrice}:${trade.pnl}:${trade.aiReasoning?.proTip ?? ""}:${trade.aiReasoning?.oneHBearishCapApplied ? 1 : 0}`,
        )
        .join("|"),
    [normalizedTradeHistory],
  );
  const isBalanceSyncing =
    !isBalanceResolved ||
    (Number(account?.currentBalance ?? 0) === 0 && normalizedOpenPositions.length === 0);
  const latestStatusLabel = String(latestStatusData?.status ?? "UNKNOWN").replaceAll("_", " ").toUpperCase();
  const latestStatusReason = latestStatusData?.reason?.trim() ||
    latestStatusData?.error?.trim() ||
    "No reason available yet.";

  // 3. Formatting Helpers (Fixes the Prop Errors)
  const formatPrice = (price: number) => {
    const formattedPrice = price < 0.01 ? price.toFixed(8) : price.toFixed(2);
    return `$${formattedPrice}`;
  };

  const formatDate = (date: Date | string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const reportDebug = (message: string, extra?: unknown) => {
    console.error("[DemoPage][Debug]", message, extra ?? "");
    setDebugMessage(message);
  };

  // 4. Local state init (non-balance fields)
  useEffect(() => {
    setAccount({
      currentBalance: 0,
      startingBalance: 0,
      openPositions: [],
      tradeHistory: [],
      equityCurve: [{ time: new Date().toISOString(), equity: 0 }],
      winRate: 0,
    });
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isDemo) {
      setWalletMode("real");
    }
  }, [isDemo, setWalletMode]);

  useEffect(() => {
    if (authLoading) return;
    let active = true;
    let profileChannel: any = null;
    let tradesChannel: any = null;

    const applyProfile = (data: any, error: unknown) => {
      console.log("Profile Fetch Result:", data, error);
      if (!active) return;

      if (error || !data) {
        setCloudSyncState("error");
        setCloudSyncMessage(
          typeof error === "string"
            ? error
            : "Profile balance row not found",
        );
        reportDebug("Profile balance fetch returned no row", { error, data });
        setIsBalanceResolved(false);
        return;
      }

      const fetchedDemoBalance = data?.demo_balance;
      const fetchedStartingBalance = data?.starting_balance;
      if (fetchedDemoBalance === null || fetchedDemoBalance === undefined) {
        setCloudSyncState("error");
        setCloudSyncMessage("profiles.demo_balance is null; waiting for sync");
        reportDebug("profiles.demo_balance is null", data);
        setIsBalanceResolved(false);
        return;
      }

      setResolvedBotUserId(String(data?.id ?? user?.id ?? "unknown"));
      setRealBalance(Number(fetchedDemoBalance));
      setRealStartingBalance(Number(fetchedStartingBalance ?? 0));
      setBalanceUpdatedAt(data?.updated_at ?? new Date().toISOString());
      setCloudSyncState("synced");
      setCloudSyncMessage(null);
      setDebugMessage(null);
      setIsBalanceResolved(true);
    };

    const fetchViaApi = async () => {
      try {
        setIsPnlSyncing(true);
        const qs = user?.id ? `?userId=${encodeURIComponent(user.id)}` : "";
        const response = await fetch(`/api/profile-balance${qs}`, { cache: "no-store" });
        const payload = await response.json();
        applyProfile(payload?.profile ?? null, payload?.ok ? null : payload?.error);
      } catch (error) {
        reportDebug("profile-balance API request failed", error);
        applyProfile(null, error);
      } finally {
        setIsPnlSyncing(false);
      }
    };

    void fetchViaApi();
    const pollId = window.setInterval(() => {
      void fetchViaApi();
    }, 5000);

    // Realtime updates are best-effort. If auth is unavailable, polling via API
    // still keeps the UI synced for single-user mode.
    if (supabase && user?.id) {
      profileChannel = supabase
        .channel(`demo-profiles-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${user.id}`,
          },
          (payload) => {
            console.log("Real-time update:", (payload.new as any)?.demo_balance);
            applyProfile(payload.new, null);
          },
        )
        .subscribe();
      tradesChannel = supabase
        .channel(`demo-trades-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "trades",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            void mutateTrades();
            void mutateOpenTrades();
            void mutateBotPerformance();
            void fetchViaApi();
          },
        )
        .subscribe();
    }

    return () => {
      active = false;
      window.clearInterval(pollId);
      if (profileChannel) {
        void supabase?.removeChannel(profileChannel);
      }
      if (tradesChannel) {
        void supabase?.removeChannel(tradesChannel);
      }
    };
  }, [authLoading, mutateBotPerformance, mutateOpenTrades, mutateTrades, user?.id, syncNonce]);

  useEffect(() => {
    if (!isHydrated || !account) return;

    const nextAvailableUsdt = Number.isFinite(realBalance) ? realBalance : 0;
    const nextCurrentBalance = Number.isFinite(portfolioNav) && portfolioNav > 0
      ? portfolioNav
      : nextAvailableUsdt;
    const nextStartingBalance = Number.isFinite(realStartingBalance) &&
        realStartingBalance > 0
      ? realStartingBalance
      : 0;
    const fallbackPnlFromBalance = Number((nextCurrentBalance - nextStartingBalance).toFixed(2));
    const performancePnl = Number(performanceSummary?.totalPnlUsd ?? NaN);
    const performanceTrades = Number(performanceSummary?.totalTrades ?? 0);
    const nextPnl = performanceTrades > 0 && Number.isFinite(performancePnl)
      ? performancePnl
      : nextStartingBalance > 0
      ? fallbackPnlFromBalance
      : Number.isFinite(combinedTradePnl)
      ? Number(combinedTradePnl.toFixed(2))
      : 0;
    const nextPnlPct = nextStartingBalance > 0
      ? Number(((nextPnl / nextStartingBalance) * 100).toFixed(2))
      : 0;
    const nextWinRate = performanceTrades > 0
      ? Number(performanceSummary?.winRatePct ?? 0)
      : 0;
    const nextWinningTrades = performanceTrades > 0
      ? Number(performanceSummary?.winCount ?? 0)
      : 0;
    const nextLosingTrades = performanceTrades > 0
      ? Number(performanceSummary?.lossCount ?? 0)
      : 0;

    setAccount((prev: any) => {
      if (!prev) return prev;
      if (
        prev.currentBalance === nextCurrentBalance &&
        prev.startingBalance === nextStartingBalance &&
        prev.totalPnl === nextPnl &&
        prev.totalPnlPercent === nextPnlPct &&
        prev.winRate === nextWinRate &&
        prev.winningTrades === nextWinningTrades &&
        prev.losingTrades === nextLosingTrades
      ) {
        return prev;
      }
      return {
        ...prev,
        currentBalance: nextCurrentBalance,
        startingBalance: nextStartingBalance,
        totalPnl: nextPnl,
        totalPnlPercent: nextPnlPct,
        winRate: nextWinRate,
        winningTrades: nextWinningTrades,
        losingTrades: nextLosingTrades,
      };
    });

    if (balanceUpdatedAt) {
      setLastCloudSync((prev) => (prev === balanceUpdatedAt ? prev : balanceUpdatedAt));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `account` is only a guard; balance inputs drive updates
  }, [
    balanceUpdatedAt,
    combinedTradePnl,
    isHydrated,
    performanceSummary,
    portfolioNav,
    realBalance,
    realStartingBalance,
  ]);

  useEffect(() => {
    if (!isBalanceResolved || !Number.isFinite(realBalance)) return;
    const previous = lastSeenBalanceRef.current;
    if (typeof previous === "number" && realBalance !== previous) {
      toast.success("New Trade Executed!");
    }
    lastSeenBalanceRef.current = realBalance;
  }, [isBalanceResolved, realBalance]);

  useEffect(() => {
    if (
      openPositionsSignatureRef.current === openPositionsSignature &&
      tradeHistorySignatureRef.current === tradeHistorySignature
    ) {
      return;
    }
    openPositionsSignatureRef.current = openPositionsSignature;
    tradeHistorySignatureRef.current = tradeHistorySignature;
    setAccount((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        openPositions: normalizedOpenPositions,
        tradeHistory: normalizedTradeHistory,
      };
    });
  }, [
    normalizedOpenPositions,
    normalizedTradeHistory,
    openPositionsSignature,
    tradeHistorySignature,
  ]);

  useEffect(() => {
    const actionable = filterActionableSignals(liveSignals);
    setTradeSignals(actionable);
  }, [liveSignals, setTradeSignals]);

  useEffect(() => {
    setProcessing(!isHydrated);
  }, [isHydrated, setProcessing]);

  // 5. Actions
  const handleCloseTrade = async (trade: any) => {
    try {
      if (!supabase || !user?.id) {
        toast.error("Supabase session unavailable.");
        return;
      }
      const symbol = String(trade.symbol ?? "").toUpperCase();
      const symbolNoQuote = symbol.replace(/USDT$/, "");
      const livePrice = Number(
        symbolToLivePrice.get(symbolNoQuote) ??
          trade.currentPrice ??
          trade.entryPrice ??
          0,
      );
      const entryPrice = Number(trade.entryPrice ?? 0);
      const amount = Number(trade.amount ?? 0);
      const initialValue = Number(trade.value ?? (entryPrice * amount) ?? 0);
      if (!Number.isFinite(livePrice) || livePrice <= 0 || amount <= 0) {
        toast.error(`Cannot close ${symbol}: invalid live price/amount`);
        return;
      }
      const pnl = Number(((livePrice - entryPrice) * amount).toFixed(8));
      const pnlPercent = initialValue > 0
        ? Number(((pnl / initialValue) * 100).toFixed(4))
        : 0;
      const closedAt = new Date().toISOString();
      const sellSignalId = `manual-sell-${Date.now()}`;

      const closeResult = await supabase
        .from("trades")
        .update({
          status: "closed",
          exitPrice: livePrice,
          pnl,
          pnlPercent,
          closed_at: closedAt,
          notes: `Manual close from demo dashboard at ${closedAt}`,
        })
        .eq("id", trade.id)
        .eq("user_id", user.id)
        .select("id");
      if (closeResult.error) throw closeResult.error;
      const closedRows = Array.isArray(closeResult.data) ? closeResult.data : [];
      if (closedRows.length === 0) {
        throw new Error("Close matched zero rows (stale id or RLS)");
      }

      const sellInsert = await supabase.from("trades").insert([{
        user_id: user.id,
        signalId: sellSignalId,
        coinId: symbolNoQuote.toLowerCase(),
        symbol,
        type: "sell",
        entryPrice,
        exitPrice: livePrice,
        amount,
        value: Number(initialValue.toFixed(8)),
        status: "closed",
        pnl,
        pnlPercent,
        opened_at: trade.openedAt ?? trade.opened_at ?? closedAt,
        closed_at: closedAt,
        followedSignal: true,
        notes: `Manual SELL from demo dashboard`,
        extra: { is_paper: true, trade_mode: "paper", manual_close: true },
      } as any]);
      if (sellInsert.error) throw sellInsert.error;

      const nextBalance = Number((realBalance + initialValue + pnl).toFixed(2));
      setRealBalance(nextBalance);
      await supabase
        .from("profiles")
        .update({ demo_balance: nextBalance, updated_at: closedAt } as any)
        .eq("id", user.id);

      await mutateTrades();
      await mutateOpenTrades();
      toast.success(
        `Closed ${symbol} at ${livePrice.toFixed(8)} (PnL ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} USDT)`,
      );
    } catch (error) {
      reportDebug("Close trade action failed", error);
      toast.error("Close action failed. Check debug panel.");
    }
  };

  const handleJournalOpen = (trade: any) => {
    try {
      toast.info(`Opening journal for ${trade.symbol}`);
    } catch (error) {
      reportDebug("Open journal action failed", error);
      toast.error("Journal action failed. Check debug panel.");
    }
  };

  // 6. Loading State
  if (!isHydrated || !account) {
    return (
      <div className="flex h-screen items-center justify-center font-mono text-primary animate-pulse">
        INITIALIZING AI ENGINE...
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center font-mono text-primary animate-pulse">
        AUTHORIZING SESSION...
      </div>
    );
  }

  if (!isBalanceResolved) {
    return (
      <div className="flex h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md border-warning/40 bg-warning/5">
          <CardContent className="space-y-3 p-5">
            <p className="font-mono text-sm text-warning">Loading balance data...</p>
            <p className="text-xs text-muted-foreground">
              {cloudSyncMessage ?? "Waiting for profile sync response."}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSyncNonce((x) => x + 1)}
            >
              Retry Sync
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto max-w-7xl space-y-6 px-3 py-4 sm:px-4 sm:py-6">
        {(cloudSyncState !== "synced" || debugMessage) && (
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="space-y-2 p-4">
              <p className="text-sm font-semibold text-warning">
                Debug Status
              </p>
              <p className="text-xs text-muted-foreground">
                {cloudSyncMessage ?? "No sync message provided"}
              </p>
              {debugMessage ? (
                <p className="wrap-break-word text-xs text-destructive">{debugMessage}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSyncNonce((x) => x + 1)}
                >
                  Retry Balance Sync
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDebugMessage(null)}
                >
                  Clear Debug
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Header Section */}
        <PageHeader
          walletMode={effectiveWalletMode}
          onWalletModeChange={(mode) => {
            if (isDemo) setWalletMode(mode);
          }}
          daysRemaining={5} // Pass a number here
          cloudSyncState={cloudSyncState}
          currentBalance={account.currentBalance || 0}
          // FIX: Wrap these in curly braces {} so they return 'void'
          onAddFunds={() => {
            try {
              toast.info("Deposit triggered");
            } catch (error) {
              reportDebug("Add funds button failed", error);
            }
          }}
          onPracticeTrade={() => {
            try {
              toast.info("Manual trade triggered");
            } catch (error) {
              reportDebug("Practice trade button failed", error);
            }
          }}
          onReset={() => {
            try {
              if (confirm("Reset account?")) {
                setAccount((prev: any) => ({
                  ...prev,
                  openPositions: [],
                  tradeHistory: [],
                  equityCurve: [{ time: new Date().toISOString(), equity: realBalance }],
                }));
                toast.success("Local dashboard state reset. DB balance kept.");
              }
            } catch (error) {
              reportDebug("Reset button failed", error);
              toast.error("Reset action failed. Check debug panel.");
            }
          }}
        />

        {/* Main Dashboard Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            <AITradingMasterControl
              // Existing props
              demoAutoPilot={demoAutoPilot}
              onToggleAutoPilot={setDemoAutoPilot}
              currentBalance={account.currentBalance}
              walletMode={effectiveWalletMode}
              cloudSyncState={cloudSyncState}
              autoPilotMode={autoPilotMode}
              executableSignalsCount={liveSignals.length}
              openPositionsCount={account.openPositions.length}
              // --- FIX: Added these missing properties ---
              onAutoPilotModeChange={(mode) => setAutoPilotMode(mode)}
              cloudSyncMessage={cloudSyncMessage}
              lastCloudSync={lastCloudSync ?? new Date().toISOString()}
              formatDate={formatDate} // This uses the formatDate function we defined earlier
              resolvedBotUserId={resolvedBotUserId}
            />
            <EquityCurve equityCurve={account.equityCurve || []} />
          </div>

          <div className="min-w-0 space-y-6">
            <StatsGrid
              currentBalance={account.currentBalance}
              availableUsdt={realBalance}
              startingBalance={account.startingBalance}
              totalPnl={account.totalPnl || 0}
              totalPnlPercent={account.totalPnlPercent || 0}
              winRate={account.winRate || 0}
              winningTrades={account.winningTrades || 0}
              losingTrades={account.losingTrades || 0}
              // Add these two lines below:
              maxDrawdown={account.maxDrawdown || 0}
              currentDrawdown={account.currentDrawdown || 0}
              formatPrice={formatPrice}
              isBalanceSyncing={isBalanceSyncing}
              isPnlSyncing={isPnlSyncing || isTradesValidating}
            />
            <TechnicalPulseCard traces={technicalPulseTraces} />
            <Card
              className={
                binanceApiError
                  ? "border-destructive/50 bg-destructive/10"
                  : "border-success/40 bg-success/10"
              }
            >
              <CardContent className="p-3">
                <p className="text-xs font-semibold">
                  Binance Account API:{" "}
                  {binanceApiError
                    ? "ERROR"
                    : binanceConfigured
                    ? "CONNECTED"
                    : "NOT CONFIGURED"}
                </p>
                {binanceApiError ? (
                  <p className="mt-1 text-[11px] text-destructive break-all">
                    {binanceApiError}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="space-y-2 p-4">
                <p className="text-sm font-semibold">Latest Status</p>
                <p className="text-sm font-medium text-primary">
                  {latestStatusLabel}: {latestStatusReason}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <p className="text-sm font-semibold">Recent Activity</p>
                {recentActivities.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No dry-run buy intents yet.
                  </p>
                ) : (
                  recentActivities.slice(0, 8).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-md border border-border/60 bg-card/80 p-2 text-xs leading-relaxed wrap-break-word"
                    >
                      {`AI considering ${item.symbol} at ${formatPrice(item.price)} (confidence ${Math.round(item.aiConfidence)}%)`}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Positions & History Section */}
        <Tabs defaultValue="history" className="w-full">
          <TabsList className="w-full justify-start gap-1 overflow-x-auto bg-secondary/20 p-1">
            <TabsTrigger value="open" className="px-6 whitespace-nowrap">
              ACTIVE POSITIONS ({account.openPositions.length})
            </TabsTrigger>
            <TabsTrigger value="history" className="px-6 whitespace-nowrap">
              TRADE HISTORY ({account.tradeHistory?.length ?? 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="open"
            className="mt-4 animate-in fade-in slide-in-from-bottom-2 space-y-4"
          >
            <OpenPositionTrackers
              positions={account.openPositions}
              priceBySymbol={symbolToLivePrice}
              isLoading={isTradesValidating && account.openPositions.length > 0}
            />
            <OpenPositionsTable
              positions={account.openPositions}
              onClose={handleCloseTrade}
              onJournalOpen={handleJournalOpen}
              formatDate={formatDate}
              formatPrice={formatPrice}
            />
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <TradeHistoryTable
              history={account.tradeHistory || []}
              onJournalOpen={handleJournalOpen}
              formatDate={formatDate}
              formatPrice={formatPrice}
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
