"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AppLayout } from "@/components/layout/app-layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EquityCurve } from "./_components/equity-curve";
import { StatsGrid } from "./_components/stats-grid";
import { PerformanceMetrics } from "./_components/performance-metrics";
import { CircuitBreakerAlert } from "./_components/circuit-breaker-alert";
import { DepositDialog } from "./_components/deposit-dialog";
import { JournalDialog } from "./_components/journal-dialog";
import { OpenPositionsTable } from "./_components/open-positions-table";
import { TradeHistoryTable } from "./_components/trade-history-table";
import { FuturesPanel } from "./_components/futures-panel";
import { PageHeader } from "./_components/page-header";
import { AITradingMasterControl } from "./_components/ai-master-control";
import { AccountOverview } from "./_components/account-overview";
import { PaperTradingStatus } from "./_components/paper-trading-status";
import { AISuggestionsPanel } from "./_components/ai-suggestions-panel";
import { Award } from "lucide-react";
import { cn } from "@/lib/utils";
import { mockDemoAccount, calculatePerformanceStats } from "@/lib/demo-data";
import type { DemoTrade, DemoAccount, AITradeSignal } from "@/lib/types";
import { toast } from "sonner";
import { mockSignals } from "@/lib/signals-data";
import { useLanguage } from "@/components/language-provider";
import { consumeQueuedDemoTrades } from "@/lib/demo-trade-queue";
import { useMarketData, useSignalsData } from "@/hooks/use-dashboard-data";
import { loadScalpingSettings } from "@/lib/trading/settings";
import { evaluateScalpingTrade } from "@/lib/trading/strategyEngine";
import { createDemoTradeFromExecution } from "@/lib/trading/tradeExecutor";
import { loadActiveCustomStrategy } from "@/lib/trading/custom-strategy";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  loadDemoWorkspaceFromSupabase,
  saveDemoWorkspaceToSupabase,
  type DemoWorkspaceSnapshot,
} from "@/lib/supabase-demo";

const DEMO_STORAGE_KEY = "nextrade-demo-account";
const DEMO_ACCOUNTS_STORAGE_KEY = "nextrade-demo-accounts";
const ACTIVE_DEMO_ACCOUNT_STORAGE_KEY = "nextrade-active-demo-account";
const WALLET_MODE_STORAGE_KEY = "nextrade-wallet-mode";
const DEMO_AUTOPILOT_STORAGE_KEY = "nextrade-demo-autopilot";
const DEMO_COPY_PROFILE_STORAGE_KEY = "nextrade-demo-copy-profile";
const DEMO_AUTOPILOT_MODE_STORAGE_KEY = "nextrade-demo-autopilot-mode";
import {
  AUTOMATION_EVENT,
  type WalletMode,
  type CopyProfile,
  type AutoPilotMode,
  type DemoAccountProfile,
  type BinanceConnectionState,
} from "./_components/types";

function signalMatchesCustomStrategy(
  signal: AITradeSignal,
  customStrategy: ReturnType<typeof loadActiveCustomStrategy>,
) {
  if (!customStrategy) return true;

  const config = customStrategy.config;
  const direction = signal.signalType.includes("BUY")
    ? "long"
    : signal.signalType.includes("SELL")
      ? "short"
      : "wait";

  if (
    config.market !== "any" &&
    signal.symbol.toUpperCase() !== config.market.toUpperCase()
  ) {
    return false;
  }

  if (signal.confidence < config.minSignalConfidence) {
    return false;
  }

  if (direction === "long" && !config.allowLong) return false;
  if (direction === "short" && !config.allowShort) return false;
  if (direction === "wait") return false;

  const indicators = signal.technicalIndicators;

  if (config.useRsi) {
    const rsiOk =
      direction === "long"
        ? indicators.rsi <= config.rsiOversold
        : indicators.rsi >= config.rsiOverbought;
    if (!rsiOk) return false;
  }

  if (config.useMacd) {
    const macdOk =
      direction === "long"
        ? indicators.macd === "bullish"
        : indicators.macd === "bearish";
    if (!macdOk) return false;
  }

  if (config.useMovingAverage) {
    const maOk =
      direction === "long"
        ? indicators.movingAverages === "above"
        : indicators.movingAverages === "below";
    if (!maOk) return false;
  }

  if (config.useVolumeSpike && indicators.volume !== "high") {
    return false;
  }

  return true;
}

const DEFAULT_FUTURES_PAIRS = [
  { symbol: "BTCUSDT", base: "BTC", price: 97500 },
  { symbol: "ETHUSDT", base: "ETH", price: 3840 },
  { symbol: "SOLUSDT", base: "SOL", price: 198 },
  { symbol: "AVAXUSDT", base: "AVAX", price: 38 },
];

const LEVERAGE_OPTIONS = [1, 2, 3, 5, 10, 20, 25, 50];
const MAX_DAILY_LOSS_PERCENT = 5; // circuit breaker threshold

function serializeAccount(account: DemoAccount) {
  return JSON.stringify({
    ...account,
    createdAt: account.createdAt.toISOString(),
    expiresAt: account.expiresAt.toISOString(),
    openPositions: account.openPositions.map((t) => ({
      ...t,
      openedAt:
        t.openedAt instanceof Date ? t.openedAt.toISOString() : t.openedAt,
      closedAt:
        t.closedAt instanceof Date ? t.closedAt.toISOString() : t.closedAt,
    })),
    tradeHistory: account.tradeHistory.map((t) => ({
      ...t,
      openedAt:
        t.openedAt instanceof Date ? t.openedAt.toISOString() : t.openedAt,
      closedAt:
        t.closedAt instanceof Date ? t.closedAt.toISOString() : t.closedAt,
    })),
  });
}

function hydrateAccount(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      expiresAt: new Date(parsed.expiresAt),
      openPositions: (parsed.openPositions ?? []).map(
        (t: DemoTrade & { openedAt: string; closedAt?: string }) => ({
          ...t,
          openedAt: new Date(t.openedAt),
          closedAt: t.closedAt ? new Date(t.closedAt) : undefined,
        }),
      ),
      tradeHistory: (parsed.tradeHistory ?? []).map(
        (t: DemoTrade & { openedAt: string; closedAt?: string }) => ({
          ...t,
          openedAt: new Date(t.openedAt),
          closedAt: t.closedAt ? new Date(t.closedAt) : undefined,
        }),
      ),
    };
  } catch {
    return null;
  }
}

function percentOf(value: number, base: number) {
  if (base <= 0) return 0;
  return (value / base) * 100;
}

function createEmptyDemoAccount(startingBalance = 0) {
  const template = cloneDemoAccount();
  const now = new Date();

  return {
    ...template,
    startingBalance,
    currentBalance: startingBalance,
    totalPnl: 0,
    totalPnlPercent: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    bestTrade: 0,
    worstTrade: 0,
    currentDrawdown: 0,
    maxDrawdown: 0,
    equityCurve:
      startingBalance > 0
        ? [{ time: now.toISOString(), equity: startingBalance }]
        : [],
    dailyPnl: 0,
    dailyPnlResetDate: now.toISOString().slice(0, 10),
    circuitBreakerTripped: false,
    openPositions: [],
    tradeHistory: [],
    createdAt: now,
    expiresAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
    isActive: true,
  };
}

function normalizeAccount(account: typeof mockDemoAccount) {
  const normalized = recalculateAccountMetrics(account);

  return {
    ...normalized,
    currentBalance:
      typeof account.currentBalance === "number" &&
      Number.isFinite(account.currentBalance)
        ? account.currentBalance
        : account.startingBalance + normalized.totalPnl,
    currentDrawdown:
      typeof account.currentDrawdown === "number" &&
      Number.isFinite(account.currentDrawdown)
        ? account.currentDrawdown
        : 0,
    maxDrawdown:
      typeof account.maxDrawdown === "number" &&
      Number.isFinite(account.maxDrawdown)
        ? account.maxDrawdown
        : 0,
    equityCurve: Array.isArray(account.equityCurve) ? account.equityCurve : [],
  };
}

function loadOrCreateAccount() {
  if (typeof window === "undefined") return cloneDemoAccount();
  const stored = localStorage.getItem(DEMO_STORAGE_KEY);
  if (stored) {
    const hydrated = hydrateAccount(stored);
    if (
      hydrated &&
      typeof hydrated.currentBalance === "number" &&
      hydrated.currentBalance >= 0
    ) {
      // Merge with fresh defaults so any new fields added later always exist
      const defaults = cloneDemoAccount();
      return normalizeAccount({
        ...defaults,
        ...hydrated,
        // Always use hydrated dates / arrays (hydrateAccount already converts them)
        createdAt: hydrated.createdAt,
        expiresAt: hydrated.expiresAt,
        openPositions: hydrated.openPositions,
        tradeHistory: hydrated.tradeHistory,
        equityCurve: hydrated.equityCurve ?? defaults.equityCurve,
        dailyPnl: hydrated.dailyPnl ?? 0,
        dailyPnlResetDate: hydrated.dailyPnlResetDate ?? "",
        circuitBreakerTripped: hydrated.circuitBreakerTripped ?? false,
      });
    }
  }
  return cloneDemoAccount();
}

function loadDemoProfiles() {
  if (typeof window === "undefined") {
    return {
      activeId: "default",
      profiles: [
        {
          id: "default",
          name: "Main Demo",
          payload: serializeAccount(cloneDemoAccount()),
        },
      ] as DemoAccountProfile[],
    };
  }

  const legacyPayload = window.localStorage.getItem(DEMO_STORAGE_KEY);
  const defaultPayload = legacyPayload ?? serializeAccount(cloneDemoAccount());

  try {
    const raw = window.localStorage.getItem(DEMO_ACCOUNTS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as DemoAccountProfile[]) : [];
    const normalized = Array.isArray(parsed)
      ? parsed.filter(
          (item) =>
            item &&
            typeof item.id === "string" &&
            typeof item.name === "string" &&
            typeof item.payload === "string",
        )
      : [];

    const profiles =
      normalized.length > 0
        ? normalized
        : [
            {
              id: "default",
              name: "Main Demo",
              payload: defaultPayload,
            },
          ];

    const storedActive = window.localStorage.getItem(
      ACTIVE_DEMO_ACCOUNT_STORAGE_KEY,
    );
    const activeId =
      storedActive && profiles.some((item) => item.id === storedActive)
        ? storedActive
        : profiles[0].id;

    return { activeId, profiles };
  } catch {
    return {
      activeId: "default",
      profiles: [
        {
          id: "default",
          name: "Main Demo",
          payload: defaultPayload,
        },
      ] as DemoAccountProfile[],
    };
  }
}

function persistDemoProfiles(profiles: DemoAccountProfile[], activeId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    DEMO_ACCOUNTS_STORAGE_KEY,
    JSON.stringify(profiles),
  );
  window.localStorage.setItem(ACTIVE_DEMO_ACCOUNT_STORAGE_KEY, activeId);
}

function cloneDemoAccount(): DemoAccount {
  return {
    ...mockDemoAccount,
    createdAt: new Date(mockDemoAccount.createdAt),
    expiresAt: new Date(mockDemoAccount.expiresAt),
    openPositions: mockDemoAccount.openPositions.map((trade) => ({
      ...trade,
      openedAt: new Date(trade.openedAt),
      closedAt: trade.closedAt ? new Date(trade.closedAt) : undefined,
    })),
    tradeHistory: mockDemoAccount.tradeHistory.map((trade) => ({
      ...trade,
      openedAt: new Date(trade.openedAt),
      closedAt: trade.closedAt ? new Date(trade.closedAt) : undefined,
    })),
  };
}

function recalculateAccountMetrics(account: DemoAccount) {
  const closedTrades = account.tradeHistory.filter(
    (trade) => typeof trade.pnl === "number",
  );
  const winning = closedTrades.filter((trade) => (trade.pnl ?? 0) > 0);
  const losing = closedTrades.filter((trade) => (trade.pnl ?? 0) < 0);
  const totalPnl = closedTrades.reduce(
    (sum, trade) => sum + (trade.pnl ?? 0),
    0,
  );

  const avgWin =
    winning.length > 0
      ? winning.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0) /
        winning.length
      : 0;
  const avgLoss =
    losing.length > 0
      ? Math.abs(
          losing.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0) /
            losing.length,
        )
      : 0;

  const bestTrade =
    closedTrades.length > 0
      ? Math.max(...closedTrades.map((trade) => trade.pnl ?? 0))
      : 0;
  const worstTrade =
    closedTrades.length > 0
      ? Math.min(...closedTrades.map((trade) => trade.pnl ?? 0))
      : 0;

  return {
    ...account,
    totalTrades: closedTrades.length,
    winningTrades: winning.length,
    losingTrades: losing.length,
    winRate:
      closedTrades.length > 0
        ? (winning.length / closedTrades.length) * 100
        : 0,
    totalPnl,
    totalPnlPercent: percentOf(totalPnl, account.startingBalance),
    avgWin,
    avgLoss,
    bestTrade,
    worstTrade,
  };
}

export default function DemoPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [isHydrated, setIsHydrated] = useState(false);
  const {
    coins: marketCoins,
    source: marketSource,
    lastUpdated: marketUpdated,
  } = useMarketData();
  const {
    signals: liveSignals,
    source: signalSource,
    lastUpdated: signalsUpdated,
  } = useSignalsData();
  const [account, setAccount] = useState(cloneDemoAccount);
  const [demoProfiles, setDemoProfiles] = useState<DemoAccountProfile[]>([]);
  const [activeDemoAccountId, setActiveDemoAccountId] = useState("default");
  const [newDemoAccountName, setNewDemoAccountName] = useState("");
  const [newDemoAccountBalance, setNewDemoAccountBalance] = useState("10000");
  const [balanceOverride, setBalanceOverride] = useState("");
  const [binanceConnection, setBinanceConnection] =
    useState<BinanceConnectionState>({
      checking: false,
      connected: false,
      configured: false,
    });
  const [walletMode, setWalletMode] = useState<WalletMode>("demo");
  const [demoAutoPilot, setDemoAutoPilot] = useState(false);
  const [autoPilotMode, setAutoPilotMode] = useState<AutoPilotMode>("signals");
  const [copyProfile, setCopyProfile] = useState<CopyProfile>("balanced");
  const [autoTradeCadenceSec, setAutoTradeCadenceSec] = useState(15);
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);
  const [cloudSyncState, setCloudSyncState] = useState<
    "disabled" | "local" | "syncing" | "synced" | "error"
  >(isSupabaseConfigured ? "local" : "disabled");
  const [cloudSyncMessage, setCloudSyncMessage] = useState<string | null>(null);
  const [lastCloudSync, setLastCloudSync] = useState<string | null>(null);
  const stats = calculatePerformanceStats(account);

  // Helper to format errors for display
  function formatErrorMessage(err: unknown): string {
    if (err instanceof Error) {
      return err.message + (err.stack ? `\n${err.stack}` : "");
    }
    if (typeof err === "string") {
      return err;
    }
    if (typeof err === "number" || typeof err === "boolean") {
      return String(err);
    }
    if (Array.isArray(err)) {
      return `Error: ${JSON.stringify(err, null, 2)}`;
    }
    if (typeof err === "object" && err !== null) {
      if ("message" in err && typeof (err as any).message === "string") {
        return (err as any).message;
      }
      if (Object.keys(err).length > 0) {
        return `Error: ${JSON.stringify(err, null, 2)}`;
      }
      return "Unknown error object";
    }
    return "Unknown error";
  }

  useEffect(() => {
    if (binanceConnection.error) {
      toast.error(formatErrorMessage(binanceConnection.error));
    }
  }, [binanceConnection.error]);

  // Deposit dialog
  const [depositDialog, setDepositDialog] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");

  // AI suggestions — top 3 BUY signals sorted by confidence
  const executableSignals = useMemo(
    () =>
      (liveSignals.length > 0 ? liveSignals : mockSignals).filter(
        (signal) =>
          signal.isActive !== false &&
          (signal.signalType === "BUY" ||
            signal.signalType === "STRONG_BUY" ||
            signal.signalType === "SELL" ||
            signal.signalType === "STRONG_SELL"),
      ),
    [liveSignals],
  );

  const aiSuggestions = useMemo(
    () =>
      [...(liveSignals.length > 0 ? liveSignals : mockSignals)]
        .filter((s) => s.signalType === "BUY" || s.signalType === "STRONG_BUY")
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3),
    [liveSignals],
  );

  const copyProfileConfig = useMemo(() => {
    if (copyProfile === "conservative") {
      return {
        allocationCapPct: 0.025,
        maxOpenPositions: 3,
      };
    }

    if (copyProfile === "aggressive") {
      return {
        allocationCapPct: 0.05,
        maxOpenPositions: 8,
      };
    }

    return {
      allocationCapPct: 0.035,
      maxOpenPositions: 5,
    };
  }, [copyProfile]);

  const buildWorkspaceSnapshot = useCallback(
    (profilesOverride?: DemoAccountProfile[]): DemoWorkspaceSnapshot => {
      const currentPayload = serializeAccount(account);
      const nextProfiles =
        profilesOverride && profilesOverride.length > 0
          ? profilesOverride
          : demoProfiles.length > 0
            ? demoProfiles.map((profile) =>
                profile.id === activeDemoAccountId
                  ? { ...profile, payload: currentPayload }
                  : profile,
              )
            : [
                {
                  id: activeDemoAccountId,
                  name: "Main Demo",
                  payload: currentPayload,
                },
              ];

      const resolvedActiveId = nextProfiles.some(
        (profile) => profile.id === activeDemoAccountId,
      )
        ? activeDemoAccountId
        : (nextProfiles[0]?.id ?? "default");

      return {
        activeId: resolvedActiveId,
        profiles: nextProfiles,
        walletMode,
        demoAutoPilot,
        autoPilotMode,
        copyProfile,
      };
    },
    [
      account,
      activeDemoAccountId,
      autoPilotMode,
      copyProfile,
      demoAutoPilot,
      demoProfiles,
      walletMode,
    ],
  );

  // Futures trading state
  const [futuresMode, setFuturesMode] = useState(false);
  const futuresPairs = useMemo(
    () =>
      DEFAULT_FUTURES_PAIRS.map((pair) => {
        const liveCoin = marketCoins.find(
          (coin) => coin.symbol.toUpperCase() === pair.base,
        );
        return {
          ...pair,
          price: liveCoin?.current_price ?? pair.price,
        };
      }),
    [marketCoins],
  );
  const [selectedPairSymbol, setSelectedPairSymbol] = useState(
    DEFAULT_FUTURES_PAIRS[0].symbol,
  );
  const selectedPair =
    futuresPairs.find((pair) => pair.symbol === selectedPairSymbol) ??
    futuresPairs[0];
  const [leverage, setLeverage] = useState(5);
  const [futuresDirection, setFuturesDirection] = useState<"LONG" | "SHORT">(
    "LONG",
  );
  const [futuresMargin, setFuturesMargin] = useState([1000]);

  // Trade journal state
  const [journalDialog, setJournalDialog] = useState<DemoTrade | null>(null);
  const [journalNote, setJournalNote] = useState("");

  useEffect(() => {
    const loaded = loadDemoProfiles();
    setDemoProfiles(loaded.profiles);
    setActiveDemoAccountId(loaded.activeId);
    const activeProfile = loaded.profiles.find(
      (item) => item.id === loaded.activeId,
    );
    const hydrated = activeProfile
      ? hydrateAccount(activeProfile.payload)
      : null;
    if (hydrated) {
      const normalized = normalizeAccount(hydrated as typeof mockDemoAccount);
      setAccount({
        ...normalized,
        openPositions: normalized.openPositions.map((t) => ({
          ...t,
          closedAt: typeof t.closedAt === "undefined" ? undefined : t.closedAt,
        })),
        tradeHistory: normalized.tradeHistory.map((t) => ({
          ...t,
          closedAt: typeof t.closedAt === "undefined" ? undefined : t.closedAt,
        })),
      });
    } else {
      const loaded = loadOrCreateAccount();
      setAccount({
        ...loaded,
        openPositions: loaded.openPositions.map((t) => ({
          ...t,
          closedAt: typeof t.closedAt === "undefined" ? undefined : t.closedAt,
        })),
        tradeHistory: loaded.tradeHistory.map((t) => ({
          ...t,
          closedAt: typeof t.closedAt === "undefined" ? undefined : t.closedAt,
        })),
      });
    }

    try {
      const storedMode = window.localStorage.getItem(
        DEMO_AUTOPILOT_MODE_STORAGE_KEY,
      );
      if (storedMode === "signals" || storedMode === "dca") {
        setAutoPilotMode(storedMode);
      }

      const storedWalletMode = window.localStorage.getItem(
        WALLET_MODE_STORAGE_KEY,
      );
      if (storedWalletMode === "demo" || storedWalletMode === "real") {
        setWalletMode(storedWalletMode);
      }

      const storedAutoPilot = window.localStorage.getItem(
        DEMO_AUTOPILOT_STORAGE_KEY,
      );
      setDemoAutoPilot(storedAutoPilot === "true");

      const storedCopyProfile = window.localStorage.getItem(
        DEMO_COPY_PROFILE_STORAGE_KEY,
      );
      if (
        storedCopyProfile === "conservative" ||
        storedCopyProfile === "balanced" ||
        storedCopyProfile === "aggressive"
      ) {
        setCopyProfile(storedCopyProfile);
      }
    } catch {
      // no-op
    }

    setIsHydrated(true);

    if (!isSupabaseConfigured) {
      setCloudSyncState("disabled");
      return;
    }

    let cancelled = false;

    void (async () => {
      const result = await loadDemoWorkspaceFromSupabase();
      if (cancelled) return;

      if (!result.ok) {
        const isMissingTable = result.error?.includes("Missing Supabase table");
        setCloudSyncEnabled(false);
        setCloudSyncState(isMissingTable ? "local" : "error");
        setCloudSyncMessage(
          isMissingTable
            ? t(
                "Supabase table not created yet. Paper trading continues in local mode.",
                "Supabase хүснэгт үүсээгүй байна. Paper trading local mode дээр үргэлжилнэ.",
              )
            : (result.error ?? "Cloud sync unavailable"),
        );
        return;
      }

      setCloudSyncEnabled(true);
      setCloudSyncState("synced");
      setCloudSyncMessage(null);
      setLastCloudSync(result.updatedAt);

      if (!result.data) return;

      setDemoProfiles(result.data.profiles);
      setActiveDemoAccountId(result.data.activeId);
      const remoteActiveProfile = result.data.profiles.find(
        (item) => item.id === result.data?.activeId,
      );
      const remoteHydrated = remoteActiveProfile
        ? hydrateAccount(remoteActiveProfile.payload)
        : null;

      if (remoteHydrated) {
        const normalized = normalizeAccount(
          remoteHydrated as typeof mockDemoAccount,
        );
        setAccount({
          ...normalized,
          openPositions: normalized.openPositions.map((t) => ({
            ...t,
            closedAt:
              typeof t.closedAt === "undefined" ? undefined : t.closedAt,
          })),
          tradeHistory: normalized.tradeHistory.map((t) => ({
            ...t,
            closedAt:
              typeof t.closedAt === "undefined" ? undefined : t.closedAt,
          })),
        });
      }

      setWalletMode(result.data.walletMode);
      setDemoAutoPilot(result.data.demoAutoPilot);
      setAutoPilotMode(result.data.autoPilotMode);
      setCopyProfile(result.data.copyProfile);
    })();

    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      window.localStorage.setItem(
        DEMO_AUTOPILOT_MODE_STORAGE_KEY,
        autoPilotMode,
      );
    } catch {
      // no-op
    }
  }, [autoPilotMode, isHydrated]);

  // Circuit breaker
  const circuitBreakerActive = account.circuitBreakerTripped ?? false;
  const dailyLossPercent = Math.abs(
    percentOf(account.dailyPnl ?? 0, account.startingBalance),
  );

  // Equity curve data
  const equityCurve = useMemo(() => {
    const base = account.equityCurve ?? [];
    // Add current equity as last point
    return [
      ...base,
      { time: new Date().toISOString(), equity: account.currentBalance },
    ];
  }, [account.equityCurve, account.currentBalance]);

  // Persist account to localStorage on every change
  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, serializeAccount(account));
      setDemoProfiles((prev) => {
        const nextProfiles =
          prev.length > 0
            ? prev.map((profile) =>
                profile.id === activeDemoAccountId
                  ? { ...profile, payload: serializeAccount(account) }
                  : profile,
              )
            : [
                {
                  id: activeDemoAccountId,
                  name: "Main Demo",
                  payload: serializeAccount(account),
                },
              ];
        persistDemoProfiles(nextProfiles, activeDemoAccountId);
        return nextProfiles;
      });
    } catch {
      /* quota exceeded — ignore */
    }
  }, [account, activeDemoAccountId, isHydrated]);

  useEffect(() => {
    if (!isHydrated || !cloudSyncEnabled) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        setCloudSyncState("syncing");
        const result = await saveDemoWorkspaceToSupabase(
          buildWorkspaceSnapshot(),
        );

        if (result.ok) {
          setCloudSyncState("synced");
          setCloudSyncMessage(null);
          setLastCloudSync(result.updatedAt);
          return;
        }

        const isMissingTable = result.error?.includes("Missing Supabase table");
        if (isMissingTable) {
          setCloudSyncEnabled(false);
          setCloudSyncState("local");
          setCloudSyncMessage(
            t(
              "Supabase table not created yet. Saving locally for now.",
              "Supabase хүснэгт үүсээгүй байна. Одоогоор local дээр хадгалж байна.",
            ),
          );
          return;
        }

        setCloudSyncState("error");
        setCloudSyncMessage(result.error ?? "Cloud save failed");
      })();
    }, 800);

    return () => window.clearTimeout(timer);
  }, [
    account,
    activeDemoAccountId,
    autoPilotMode,
    buildWorkspaceSnapshot,
    cloudSyncEnabled,
    copyProfile,
    demoAutoPilot,
    demoProfiles,
    isHydrated,
    walletMode,
  ]);

  // Daily PnL reset check (reset at midnight)
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if ((account.dailyPnlResetDate ?? "") !== today) {
      setAccount((prev) => ({
        ...prev,
        dailyPnl: 0,
        dailyPnlResetDate: today,
        circuitBreakerTripped: false,
      }));
    }
  }, [account.dailyPnlResetDate]);

  const daysRemaining = Math.ceil(
    (account.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  const getLivePriceForSymbol = (symbol: string, fallback: number) => {
    const normalized = symbol.replace(/USDT$/i, "").toLowerCase();
    const coin = marketCoins.find((item) => item.symbol === normalized);
    return coin?.current_price ?? fallback;
  };

  const makeSpotTradeFromSignal = (
    signal: AITradeSignal,
    tradeValue: number,
  ): DemoTrade => {
    const liveEntry = getLivePriceForSymbol(signal.symbol, signal.entryPrice);
    const amount = tradeValue / liveEntry;

    return {
      id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      signalId: signal.id,
      coinId: signal.coinId,
      symbol: signal.symbol,
      type: signal.signalType.includes("SELL") ? "sell" : "buy",
      entryPrice: liveEntry,
      amount: Number(amount.toFixed(6)),
      value: Number(tradeValue.toFixed(2)),
      status: "open",
      openedAt: new Date(),
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfits[0]?.price ?? liveEntry * 1.05,
      followedSignal: true,
    };
  };

  const formatPrice = (price: number) => {
    if (price >= 1000)
      return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    if (price >= 1) return `$${price.toFixed(2)}`;
    return `$${price.toFixed(4)}`;
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  useEffect(() => {
    try {
      localStorage.setItem(WALLET_MODE_STORAGE_KEY, walletMode);
    } catch {
      // no-op
    }
  }, [walletMode]);

  useEffect(() => {
    try {
      localStorage.setItem(
        DEMO_AUTOPILOT_STORAGE_KEY,
        demoAutoPilot ? "true" : "false",
      );
    } catch {
      // no-op
    }
  }, [demoAutoPilot]);

  useEffect(() => {
    try {
      localStorage.setItem(DEMO_COPY_PROFILE_STORAGE_KEY, copyProfile);
    } catch {
      // no-op
    }
  }, [copyProfile]);

  useEffect(() => {
    const applyAutoPilot = (enabled: boolean) => {
      if (walletMode === "real") {
        setDemoAutoPilot(false);
        return;
      }
      setDemoAutoPilot(enabled);
    };

    const onAutomationToggle = (event: Event) => {
      const custom = event as CustomEvent<{ enabled?: boolean }>;
      if (typeof custom.detail?.enabled !== "boolean") return;
      applyAutoPilot(custom.detail.enabled);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== DEMO_AUTOPILOT_STORAGE_KEY) return;
      applyAutoPilot(event.newValue === "true");
    };

    window.addEventListener(
      AUTOMATION_EVENT,
      onAutomationToggle as EventListener,
    );
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(
        AUTOMATION_EVENT,
        onAutomationToggle as EventListener,
      );
      window.removeEventListener("storage", onStorage);
    };
  }, [walletMode]);

  const requireDemoMode = (feature: string) => {
    if (walletMode === "demo") return true;
    toast.info(t("Real wallet mode selected", "Real wallet горим сонгогдсон"), {
      description: t(
        `${feature} currently works in Demo wallet only. Connect API keys in Settings for live execution.`,
        `${feature} одоогоор зөвхөн Demo wallet дээр ажиллана. Live гүйцэтгэлд Settings дээр API key холбоно уу.`,
      ),
    });
    return false;
  };
  const checkBinanceConnection = async () => {
    setBinanceConnection((prev) => ({ ...prev, checking: true }));
    try {
      const response = await fetch("/api/binance/account", {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        configured?: boolean;
        canTrade?: boolean;
        error?: any;
      };

      if (!response.ok) {
        const errorMsg = formatErrorMessage(data.error ?? "Connection failed");
        setBinanceConnection({
          checking: false,
          connected: false,
          configured: Boolean(data.configured),
          error: errorMsg,
        });
        return;
      }

      setBinanceConnection({
        checking: false,
        connected: Boolean(data.configured && data.canTrade),
        configured: Boolean(data.configured),
        error: undefined,
      });
    } catch (error) {
      const errorMsg =
        formatErrorMessage(error) || "Unable to reach Binance account API";
      setBinanceConnection({
        checking: false,
        connected: false,
        configured: false,
        error: errorMsg,
      });
    }
  };

  const switchDemoAccount = (accountId: string) => {
    if (accountId === activeDemoAccountId) return;
    const target = demoProfiles.find((item) => item.id === accountId);
    if (!target) return;
    const hydrated = hydrateAccount(target.payload);
    if (!hydrated) return;

    setActiveDemoAccountId(accountId);
    const normalized = normalizeAccount(hydrated as typeof mockDemoAccount);
    setAccount({
      ...normalized,
      openPositions: normalized.openPositions.map((t) => ({
        ...t,
        closedAt: typeof t.closedAt === "undefined" ? undefined : t.closedAt,
      })),
      tradeHistory: normalized.tradeHistory.map((t) => ({
        ...t,
        closedAt: typeof t.closedAt === "undefined" ? undefined : t.closedAt,
      })),
    });
    persistDemoProfiles(demoProfiles, accountId);
  };

  const removeActiveDemoAccount = () => {
    if (demoProfiles.length <= 1) {
      toast.error(
        t(
          "You must keep at least one demo account.",
          "Хамгийн багадаа нэг demo account үлдээх ёстой.",
        ),
      );
      return;
    }

    const removed = demoProfiles.find((p) => p.id === activeDemoAccountId);
    const nextProfiles = demoProfiles.filter(
      (p) => p.id !== activeDemoAccountId,
    );
    const nextActiveId = nextProfiles[0]?.id ?? "default";

    setDemoProfiles(nextProfiles);
    setActiveDemoAccountId(nextActiveId);
    persistDemoProfiles(nextProfiles, nextActiveId);

    const nextActive = nextProfiles.find((p) => p.id === nextActiveId);
    const hydrated = nextActive ? hydrateAccount(nextActive.payload) : null;
    if (hydrated) {
      const normalized = normalizeAccount(hydrated as typeof mockDemoAccount);
      setAccount({
        ...normalized,
        openPositions: normalized.openPositions.map((t) => ({
          ...t,
          closedAt: typeof t.closedAt === "undefined" ? undefined : t.closedAt,
        })),
        tradeHistory: normalized.tradeHistory.map((t) => ({
          ...t,
          closedAt: typeof t.closedAt === "undefined" ? undefined : t.closedAt,
        })),
      });
    } else {
      setAccount(cloneDemoAccount());
    }

    toast.success(t("Demo account removed", "Demo account устгалаа"), {
      description: t(
        removed ? `Removed "${removed.name}".` : "Removed active demo account.",
        removed
          ? `"${removed.name}" устгалаа.`
          : "Идэвхтэй demo account устгалаа.",
      ),
    });
  };

  const createDemoAccountProfile = () => {
    const requestedBalance = Number.parseFloat(newDemoAccountBalance);
    const validBalance =
      Number.isFinite(requestedBalance) && requestedBalance >= 0
        ? requestedBalance
        : 0;
    const profile: DemoAccountProfile = {
      id: `demo-profile-${Date.now()}`,
      name: newDemoAccountName.trim() || `Demo ${demoProfiles.length + 1}`,
      payload: serializeAccount(createEmptyDemoAccount(validBalance)),
    };
    const next = [profile, ...demoProfiles].slice(0, 10);
    setDemoProfiles(next);
    setActiveDemoAccountId(profile.id);
    setAccount(createEmptyDemoAccount(validBalance));
    persistDemoProfiles(next, profile.id);
    setNewDemoAccountName("");
    setNewDemoAccountBalance("10000");
    toast.success(t("New demo account created", "Шинэ demo account үүслээ"), {
      description: `${profile.name} · $${validBalance.toLocaleString()}`,
    });
  };

  const applyBalanceOverride = () => {
    const value = Number.parseFloat(balanceOverride);
    if (!Number.isFinite(value) || value < 0) {
      toast.error(t("Enter valid balance", "Зөв үлдэгдэл оруулна уу"));
      return;
    }

    setAccount((prev) => ({
      ...prev,
      currentBalance: value,
      startingBalance: value,
      totalPnl: 0,
      totalPnlPercent: 0,
      dailyPnl: 0,
      circuitBreakerTripped: false,
      openPositions: [],
      tradeHistory: [],
      equityCurve: [{ time: new Date().toISOString(), equity: value }],
    }));
    setBalanceOverride("");
    toast.success(t("Balance updated", "Үлдэгдэл шинэчлэгдлээ"), {
      description: `$${value.toLocaleString()}`,
    });
  };

  useEffect(() => {
    if (!isHydrated) return;
    if (walletMode !== "real") return;
    void checkBinanceConnection();
  }, [isHydrated, walletMode]);

  const handleCloseTrade = (trade: DemoTrade) => {
    if (!requireDemoMode("Close trade")) return;
    setAccount((prev) => {
      const liveClose = getLivePriceForSymbol(trade.symbol, trade.entryPrice);
      const slippage = 1 + (Math.random() * 0.006 - 0.003);
      const closePrice = liveClose * slippage;

      let rawPnl: number;
      if (trade.isFutures && trade.direction) {
        // Futures P&L: (exit - entry) * position_size * leverage_direction
        const multiplier = trade.direction === "LONG" ? 1 : -1;
        rawPnl = (closePrice - trade.entryPrice) * trade.amount * multiplier;
      } else {
        rawPnl =
          trade.type === "buy"
            ? (closePrice - trade.entryPrice) * trade.amount
            : (trade.entryPrice - closePrice) * trade.amount;
      }
      const pnl = Number(rawPnl.toFixed(2));
      const effectiveValue = trade.isFutures
        ? (trade.marginUsed ?? trade.value)
        : trade.value;
      const pnlPercent = Number(((pnl / effectiveValue) * 100).toFixed(2));

      const newDailyPnl = (prev.dailyPnl ?? 0) + pnl;
      const hitCircuitBreaker =
        percentOf(Math.abs(newDailyPnl), prev.startingBalance) >=
          MAX_DAILY_LOSS_PERCENT && newDailyPnl < 0;

      if (hitCircuitBreaker) {
        toast.error(
          t("Circuit Breaker Triggered!", "Хамгаалалтын систем ажиллалаа!"),
          {
            description: t(
              `Daily loss exceeded ${MAX_DAILY_LOSS_PERCENT}%. Trading halted for today.`,
              `Өнөөдрийн алдагдал ${MAX_DAILY_LOSS_PERCENT}%-иас давлаа. Арилжаа зогссон.`,
            ),
          },
        );
      }

      const closedTrade: DemoTrade = {
        ...trade,
        status:
          trade.isFutures && pnlPercent <= -(100 / (trade.leverage ?? 1))
            ? "liquidated"
            : pnl >= 0
              ? "closed"
              : "stopped",
        exitPrice: Number(closePrice.toFixed(closePrice >= 1 ? 2 : 4)),
        pnl,
        pnlPercent,
        closedAt: new Date(),
      };

      // Add to equity curve — return locked capital + P&L
      const newEquity = prev.currentBalance + effectiveValue + pnl;
      const newCurvePoint = {
        time: new Date().toISOString(),
        equity: newEquity,
      };

      const updated = recalculateAccountMetrics({
        ...prev,
        currentBalance: newEquity,
        dailyPnl: newDailyPnl,
        circuitBreakerTripped: hitCircuitBreaker,
        equityCurve: [...(prev.equityCurve ?? []), newCurvePoint],
        openPositions: prev.openPositions
          .filter((item) => item.id !== trade.id)
          .map((t) => ({
            ...t,
            closedAt:
              typeof t.closedAt === "undefined" ? undefined : t.closedAt,
          })),
        tradeHistory: [
          {
            ...closedTrade,
            closedAt:
              typeof closedTrade.closedAt === "undefined"
                ? undefined
                : closedTrade.closedAt,
          },
          ...prev.tradeHistory.map((t) => ({
            ...t,
            closedAt:
              typeof t.closedAt === "undefined" ? undefined : t.closedAt,
          })),
        ],
      });

      toast.success(
        t(
          `Closed ${trade.symbol} ${trade.isFutures ? trade.direction : ""} position`,
          `${trade.symbol} ${trade.isFutures ? trade.direction : ""} байрлалыг хаалаа`,
        ),
        {
          description: `P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)${trade.isFutures ? ` | ${trade.leverage}x` : ""}`,
        },
      );

      return updated;
    });
  };

  const handleResetAccount = () => {
    if (!requireDemoMode("Reset account")) return;
    const fresh = createEmptyDemoAccount(0);
    setAccount(fresh);
    toast.info(t("Demo account reset!", "Demo account шинэчлэгдлээ!"), {
      description: t(
        "Account cleared to $0. Add funds to set a new practice balance.",
        "Данс $0 болж цэвэрлэгдлээ. Шинэ дадлагын үлдэгдэл тохируулахын тулд мөнгө нэмнэ үү.",
      ),
    });
  };

  const handleOpenPracticeTrade = () => {
    if (!requireDemoMode("Practice trade")) return;
    const signal =
      executableSignals[Math.floor(Math.random() * executableSignals.length)];
    if (!signal) {
      toast.error(formatErrorMessage("No AI signals available"));
      return;
    }
    const tradeValue =
      signal.currentPrice > 1000
        ? 5000
        : signal.currentPrice > 50
          ? 4000
          : 2500;
    const trade = makeSpotTradeFromSignal(signal, tradeValue);

    setAccount((prev) => ({
      ...prev,
      currentBalance: Math.max(0, prev.currentBalance - trade.value),
      openPositions: [
        {
          ...trade,
          closedAt:
            typeof trade.closedAt === "undefined" ? undefined : trade.closedAt,
        },
        ...prev.openPositions.map((t) => ({
          ...t,
          closedAt: typeof t.closedAt === "undefined" ? undefined : t.closedAt,
        })),
      ],
    }));

    toast.success(t("Practice trade opened!", "Дадлагын арилжаа нээгдлээ!"), {
      description: t(
        `${signal.symbol} ${trade.type.toUpperCase()} @ $${signal.entryPrice.toLocaleString()} — check Open Positions tab below`,
        `${signal.symbol} ${trade.type.toUpperCase()} @ $${signal.entryPrice.toLocaleString()} — доорх Open Positions табыг харна уу`,
      ),
    });
  };

  const handleDeposit = () => {
    if (!requireDemoMode("Add funds")) return;
    const amount = parseFloat(depositAmount);
    if (!amount || amount <= 0) {
      toast.error(formatErrorMessage("Enter a valid amount"));
      return;
    }
    if (amount > 1_000_000) {
      toast.error(formatErrorMessage("Maximum deposit is $1,000,000"));
      return;
    }
    const isFreshAccount =
      account.startingBalance === 0 &&
      account.currentBalance === 0 &&
      account.openPositions.length === 0 &&
      account.tradeHistory.length === 0;

    setAccount((prev) => {
      const newBalance = prev.currentBalance + amount;

      return {
        ...prev,
        startingBalance: isFreshAccount ? amount : prev.startingBalance,
        currentBalance: newBalance,
        equityCurve: [
          ...(prev.equityCurve ?? []),
          {
            time: new Date().toISOString(),
            equity: newBalance,
          },
        ],
      };
    });
    toast.success(
      t(
        `Added $${amount.toLocaleString()} to your demo account!`,
        `$${amount.toLocaleString()} демо данс руу нэмэгдлээ!`,
      ),
      {
        description: t(
          isFreshAccount
            ? "This amount is now your new practice starting balance."
            : "AI suggestions updated based on new balance.",
          isFreshAccount
            ? "Энэ дүн таны шинэ дадлагын эхлэх үлдэгдэл боллоо."
            : "Шинэ үлдэгдэлд тулгуурлан AI зөвлөмж шинэчлэгдлээ.",
        ),
      },
    );
    setDepositDialog(false);
    setDepositAmount("");
  };

  const handleExecuteAISuggestion = (signal: AITradeSignal) => {
    if (!requireDemoMode("AI suggestion execution")) return;
    if (circuitBreakerActive) {
      toast.error(
        formatErrorMessage("Circuit breaker active — trading halted"),
      );
      return;
    }
    const tradeSize = Math.floor(account.currentBalance * 0.05);
    if (tradeSize < 10) {
      toast.error(formatErrorMessage("Balance too low for AI trade (min $10)"));
      return;
    }
    const trade = makeSpotTradeFromSignal(signal, tradeSize);
    setAccount((prev) => ({
      ...prev,
      currentBalance: Math.max(0, prev.currentBalance - tradeSize),
      openPositions: [
        {
          ...trade,
          closedAt:
            typeof trade.closedAt === "undefined" ? undefined : trade.closedAt,
        },
        ...prev.openPositions.map((t) => ({
          ...t,
          closedAt: typeof t.closedAt === "undefined" ? undefined : t.closedAt,
        })),
      ],
    }));
    toast.success(
      t(
        `AI trade executed: ${signal.symbol}`,
        `AI арилжаа нээгдлээ: ${signal.symbol}`,
      ),
      {
        description: `${trade.type.toUpperCase()} $${tradeSize.toLocaleString()} @ $${trade.entryPrice.toLocaleString()}`,
      },
    );
  };
  const handleOpenFuturesTrade = () => {
    if (!requireDemoMode("Futures trade")) return;
    if (circuitBreakerActive) {
      toast.error(
        formatErrorMessage("Circuit breaker active — trading halted"),
      );
      return;
    }
    const margin = futuresMargin[0];
    if (margin > account.currentBalance) {
      toast.error(formatErrorMessage("Insufficient balance"));
      return;
    }

    const pair = selectedPair;
    const positionSize = margin * leverage;
    const amount = positionSize / pair.price;

    // Liquidation price calculation
    const liqDistance = pair.price / leverage;
    const liqPrice =
      futuresDirection === "LONG"
        ? pair.price - liqDistance * 0.9
        : pair.price + liqDistance * 0.9;

    const slDistance =
      pair.price * (futuresDirection === "LONG" ? 0.02 : -0.02);
    const tpDistance =
      pair.price * (futuresDirection === "LONG" ? 0.04 : -0.04);

    const trade: DemoTrade = {
      id: `futures-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      signalId: `futures-signal-${pair.symbol}`,
      coinId: pair.base.toLowerCase(),
      symbol: pair.symbol,
      type: futuresDirection === "LONG" ? "buy" : "sell",
      direction: futuresDirection,
      leverage,
      marginUsed: margin,
      liquidationPrice: Number(liqPrice.toFixed(2)),
      isFutures: true,
      entryPrice: pair.price,
      amount: Number(amount.toFixed(6)),
      value: positionSize,
      status: "open",
      openedAt: new Date(),
      stopLoss: Number((pair.price - slDistance).toFixed(2)),
      takeProfit: Number((pair.price + tpDistance).toFixed(2)),
      followedSignal: false,
    };

    setAccount((prev) => ({
      ...prev,
      currentBalance: Math.max(0, prev.currentBalance - margin),
      openPositions: [
        {
          ...trade,
          closedAt:
            typeof trade.closedAt === "undefined" ? undefined : trade.closedAt,
        },
        ...prev.openPositions.map((t) => ({
          ...t,
          closedAt: typeof t.closedAt === "undefined" ? undefined : t.closedAt,
        })),
      ],
    }));

    toast.success(
      t(
        `Opened ${futuresDirection} ${pair.symbol} (${leverage}x)`,
        `${pair.symbol} ${futuresDirection} нээлээ (${leverage}x)`,
      ),
      {
        description: `Margin: $${margin.toLocaleString()} | Position: $${positionSize.toLocaleString()} | Liq: $${liqPrice.toFixed(2)}`,
      },
    );
  };

  const handleAddJournalNote = () => {
    if (!journalDialog || !journalNote.trim()) return;
    setAccount((prev) => ({
      ...prev,
      tradeHistory: prev.tradeHistory.map((t) =>
        t.id === journalDialog.id ? { ...t, notes: journalNote.trim() } : t,
      ),
      openPositions: prev.openPositions.map((t) =>
        t.id === journalDialog.id ? { ...t, notes: journalNote.trim() } : t,
      ),
    }));
    toast.success(t("Note saved", "Тэмдэглэл хадгалагдлаа"));
    setJournalDialog(null);
    setJournalNote("");
  };

  useEffect(() => {
    if (walletMode === "real") return;
    const user_id = "00000000-0000-0000-0000-000000000000";
    (async () => {
      const queuedTrades = await consumeQueuedDemoTrades(user_id);
      if (!queuedTrades || queuedTrades.length === 0) return;

      setAccount((prev) => {
        const existing = new Set(prev.openPositions.map((trade) => trade.id));
        const newTrades = Array.isArray(queuedTrades)
          ? queuedTrades.filter((trade) => trade.id && !existing.has(trade.id))
          : [];
        const totalCost = newTrades.reduce((sum, t) => sum + (t.value || 0), 0);
        const merged = [...newTrades, ...prev.openPositions].slice(0, 20);
        return {
          ...prev,
          currentBalance: Math.max(0, prev.currentBalance - totalCost),
          openPositions: merged.map((t) => ({
            ...t,
            closedAt:
              typeof t.closedAt === "undefined" ? undefined : t.closedAt,
          })),
        };
      });

      toast.success(
        t(
          `${queuedTrades.length} paper trade(s) imported from Signals`,
          `Signals-оос ${queuedTrades.length} paper trade импортлов`,
        ),
        {
          description: t(
            "Demo mode only. No live exchange order sent.",
            "Зөвхөн Демо горим. Live exchange захиалга илгээгээгүй.",
          ),
        },
      );
    })();
  }, [t, walletMode]);

  useEffect(() => {
    if (walletMode === "real") return;
    if (!demoAutoPilot) return;

    const timer = setInterval(() => {
      setAccount((prev) => {
        const scalpingSettings = loadScalpingSettings();
        const selectedCustomStrategy = loadActiveCustomStrategy();
        const selectedConfig = selectedCustomStrategy?.config;
        const effectiveSettings = {
          ...scalpingSettings,
          minAiConfidence: Math.max(
            scalpingSettings.minAiConfidence,
            selectedConfig?.minSignalConfidence ?? 0,
          ),
          stopLossPct:
            selectedConfig?.stopLossPct ?? scalpingSettings.stopLossPct,
          takeProfitPct:
            selectedConfig?.takeProfitPct ?? scalpingSettings.takeProfitPct,
          maxPositionSizePct: Math.min(
            scalpingSettings.maxPositionSizePct,
            selectedConfig?.maxPositionSize ??
              scalpingSettings.maxPositionSizePct,
          ),
          maxDailyLossPct: Math.min(
            scalpingSettings.maxDailyLossPct,
            selectedConfig?.maxDailyLoss ?? scalpingSettings.maxDailyLossPct,
          ),
          useTrailingStop:
            selectedConfig?.useTrailingStop ?? scalpingSettings.useTrailingStop,
        };
        // Circuit breaker check
        if (prev.circuitBreakerTripped) return prev;

        const exitCandidate = prev.openPositions.find((trade) => {
          const livePrice = getLivePriceForSymbol(
            trade.symbol,
            trade.entryPrice,
          );
          const isLong = trade.isFutures
            ? trade.direction === "LONG"
            : trade.type === "buy";
          const trailingStop = trade.trailingStopPct
            ? isLong
              ? Math.max(
                  trade.stopLoss,
                  livePrice > trade.entryPrice
                    ? livePrice * (1 - trade.trailingStopPct / 100)
                    : trade.stopLoss,
                )
              : Math.min(
                  trade.stopLoss,
                  livePrice < trade.entryPrice
                    ? livePrice * (1 + trade.trailingStopPct / 100)
                    : trade.stopLoss,
                )
            : trade.stopLoss;
          const stopTriggered = isLong
            ? livePrice <= trailingStop
            : livePrice >= trailingStop;
          const takeTriggered = isLong
            ? livePrice >= trade.takeProfit
            : livePrice <= trade.takeProfit;
          const timedOut =
            Date.now() - new Date(trade.openedAt).getTime() >= 20 * 60 * 1000;

          return stopTriggered || takeTriggered || timedOut;
        });

        if (exitCandidate) {
          const liveClose = getLivePriceForSymbol(
            exitCandidate.symbol,
            exitCandidate.entryPrice,
          );
          const closeSlippage =
            1 +
            (Math.random() * 0.0025 - 0.00125) *
              (exitCandidate.type === "sell" ? -1 : 1);
          const closePrice = liveClose * closeSlippage;

          let rawPnl: number;
          if (exitCandidate.isFutures && exitCandidate.direction) {
            const multiplier = exitCandidate.direction === "LONG" ? 1 : -1;
            rawPnl =
              (closePrice - exitCandidate.entryPrice) *
              exitCandidate.amount *
              multiplier;
          } else {
            rawPnl =
              exitCandidate.type === "buy"
                ? (closePrice - exitCandidate.entryPrice) * exitCandidate.amount
                : (exitCandidate.entryPrice - closePrice) *
                  exitCandidate.amount;
          }
          const pnl = Number(rawPnl.toFixed(2));
          const effectiveValue = exitCandidate.isFutures
            ? (exitCandidate.marginUsed ?? exitCandidate.value)
            : exitCandidate.value;
          const pnlPercent = Number(((pnl / effectiveValue) * 100).toFixed(2));

          const newDailyPnl = (prev.dailyPnl ?? 0) + pnl;
          const hitCB =
            newDailyPnl < 0 &&
            percentOf(Math.abs(newDailyPnl), prev.startingBalance) >=
              scalpingSettings.maxDailyLossPct;

          const closedTrade: DemoTrade = {
            ...exitCandidate,
            status: pnl >= 0 ? "closed" : "stopped",
            exitPrice: Number(closePrice.toFixed(closePrice >= 1 ? 2 : 4)),
            pnl,
            pnlPercent,
            closedAt: new Date(),
          };

          const newEquity = prev.currentBalance + effectiveValue + pnl;

          return recalculateAccountMetrics({
            ...prev,
            currentBalance: newEquity,
            dailyPnl: newDailyPnl,
            circuitBreakerTripped: hitCB,
            equityCurve: [
              ...(prev.equityCurve ?? []),
              { time: new Date().toISOString(), equity: newEquity },
            ],
            openPositions: prev.openPositions
              .filter((item) => item.id !== exitCandidate.id)
              .map((t) => ({
                ...t,
                closedAt:
                  typeof t.closedAt === "undefined" ? undefined : t.closedAt,
              })),
            tradeHistory: [
              {
                ...closedTrade,
                closedAt:
                  typeof closedTrade.closedAt === "undefined"
                    ? undefined
                    : closedTrade.closedAt,
              },
              ...prev.tradeHistory.map((t) => ({
                ...t,
                closedAt:
                  typeof t.closedAt === "undefined" ? undefined : t.closedAt,
              })),
            ],
          });
        }

        if (prev.openPositions.length >= copyProfileConfig.maxOpenPositions) {
          return prev;
        }

        const existingSignalIds = new Set(
          prev.openPositions.map((trade) => trade.signalId),
        );

        if (autoPilotMode === "dca") {
          const dcaCandidates = executableSignals
            .filter((signal) => signal.signalType.includes("BUY"))
            .filter((signal) => !existingSignalIds.has(signal.id))
            .filter((signal) =>
              signalMatchesCustomStrategy(signal, selectedCustomStrategy),
            )
            .sort((left, right) => right.confidence - left.confidence);

          const target = dcaCandidates[0];
          if (!target) return prev;

          const dcaNotional = Math.max(
            50,
            prev.currentBalance * copyProfileConfig.allocationCapPct * 0.6,
          );
          const dcaTrade = makeSpotTradeFromSignal(target, dcaNotional);
          dcaTrade.notes = `Auto DCA buy · ${selectedConfig?.name ?? "Default DCA"}`;
          dcaTrade.tags = ["auto", "dca", target.symbol];

          return {
            ...prev,
            currentBalance: Math.max(0, prev.currentBalance - dcaNotional),
            openPositions: [dcaTrade, ...prev.openPositions].slice(
              0,
              copyProfileConfig.maxOpenPositions,
            ),
          };
        }

        const rankedCandidates = executableSignals
          .filter((signal) => !existingSignalIds.has(signal.id))
          .filter((signal) =>
            signalMatchesCustomStrategy(signal, selectedCustomStrategy),
          )
          .map((signal) => {
            const coin = marketCoins.find(
              (item) =>
                item.symbol.toUpperCase() === signal.symbol.toUpperCase(),
            );
            const decision = evaluateScalpingTrade({
              signal,
              coin,
              account: prev,
              settings: effectiveSettings,
              preferredAllocationPct: copyProfileConfig.allocationCapPct,
            });

            return { signal, decision };
          })
          .filter((item) => item.decision.status === "execute")
          .sort((left, right) => right.decision.score - left.decision.score);

        const bestCandidate = rankedCandidates[0];
        if (
          !bestCandidate?.decision.execution ||
          !bestCandidate.decision.risk
        ) {
          return prev;
        }

        const newTrade = createDemoTradeFromExecution({
          signal: bestCandidate.signal,
          followedSignal: true,
          execution: bestCandidate.decision.execution,
          riskPlan: bestCandidate.decision.risk,
          decisionScore: bestCandidate.decision.score,
          reasons: [
            ...(selectedConfig?.name
              ? [`Strategy: ${selectedConfig.name}`]
              : []),
            ...bestCandidate.decision.reasons,
          ],
        });

        const tradeCapital = newTrade.isFutures
          ? (newTrade.marginUsed ?? newTrade.value)
          : newTrade.value;

        return {
          ...prev,
          currentBalance: Math.max(0, prev.currentBalance - tradeCapital),
          openPositions: [newTrade, ...prev.openPositions].slice(
            0,
            copyProfileConfig.maxOpenPositions,
          ),
        };
      });
    }, autoTradeCadenceSec * 1000);

    return () => clearInterval(timer);
  }, [
    autoPilotMode,
    autoTradeCadenceSec,
    copyProfileConfig,
    demoAutoPilot,
    executableSignals,
    marketCoins,
    walletMode,
  ]);

  if (!isHydrated) {
    return (
      <AppLayout>
        <div className="container mx-auto px-4 py-6 md:px-6 lg:py-8">
          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>
                {t("Loading demo workspace...", "Demo орчин ачааллаж байна...")}
              </CardTitle>
              <CardDescription>
                {t(
                  "Syncing local settings and account snapshot.",
                  "Локал тохиргоо болон дансны төлөвийг синк хийж байна.",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-primary/60" />
              </div>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 md:px-6 lg:py-8">
        {/* Page Header */}
        <PageHeader
          walletMode={walletMode}
          onWalletModeChange={setWalletMode}
          daysRemaining={daysRemaining}
          cloudSyncState={cloudSyncState}
          onAddFunds={() => setDepositDialog(true)}
          onPracticeTrade={handleOpenPracticeTrade}
          onReset={handleResetAccount}
        />
        {/* Full AI Trading Master Control */}
        <AITradingMasterControl
          demoAutoPilot={demoAutoPilot}
          onToggleAutoPilot={setDemoAutoPilot}
          autoPilotMode={autoPilotMode}
          onAutoPilotModeChange={setAutoPilotMode}
          walletMode={walletMode}
          currentBalance={account.currentBalance}
          openPositionsCount={account.openPositions.length}
          executableSignalsCount={executableSignals.length}
          cloudSyncState={cloudSyncState}
          cloudSyncMessage={cloudSyncMessage}
          lastCloudSync={lastCloudSync}
          formatDate={formatDate}
        />
        {/* Account Overview */}
        <AccountOverview
          walletMode={walletMode}
          demoAutoPilot={demoAutoPilot}
          onDemoAutoPilotChange={setDemoAutoPilot}
          autoPilotMode={autoPilotMode}
          onAutoPilotModeChange={setAutoPilotMode}
          copyProfile={copyProfile}
          onCopyProfileChange={setCopyProfile}
          copyProfileConfig={copyProfileConfig}
          autoTradeCadenceSec={autoTradeCadenceSec}
          onCadenceChange={setAutoTradeCadenceSec}
          demoProfiles={demoProfiles}
          activeDemoAccountId={activeDemoAccountId}
          onSwitchAccount={switchDemoAccount}
          balanceOverride={balanceOverride}
          onBalanceOverrideChange={setBalanceOverride}
          onApplyBalanceOverride={applyBalanceOverride}
          newDemoAccountName={newDemoAccountName}
          onNewDemoAccountNameChange={setNewDemoAccountName}
          newDemoAccountBalance={newDemoAccountBalance}
          onNewDemoAccountBalanceChange={setNewDemoAccountBalance}
          onCreateDemoAccount={createDemoAccountProfile}
          onRemoveDemoAccount={removeActiveDemoAccount}
          binanceConnection={binanceConnection}
          onCheckBinanceConnection={checkBinanceConnection}
        />
        <PaperTradingStatus
          demoAutoPilot={demoAutoPilot}
          currentBalance={account.currentBalance}
          marketSource={marketSource}
          signalSource={signalSource}
          copyProfile={copyProfile}
          winRate={account.winRate}
          executableSignalsCount={executableSignals.length}
          openPositionsCount={account.openPositions.length}
          marketUpdated={marketUpdated}
          signalsUpdated={signalsUpdated}
        />
        {/* Fully Automatic AI Crypto Trader */}
        <AISuggestionsPanel
          signals={aiSuggestions}
          demoAutoPilot={demoAutoPilot}
          currentBalance={account.currentBalance}
          openPositions={account.openPositions}
          signalSource={signalSource}
          walletMode={walletMode}
          onExecute={handleExecuteAISuggestion}
        />
        {/* Circuit Breaker Alert */}
        {circuitBreakerActive && (
          <CircuitBreakerAlert
            dailyLossPercent={dailyLossPercent}
            dailyPnl={account.dailyPnl ?? 0}
            onReset={() =>
              setAccount((prev) => ({
                ...prev,
                circuitBreakerTripped: false,
                dailyPnl: 0,
              }))
            }
          />
        )}
        {/* Futures Trading Panel */}
        <FuturesPanel
          enabled={futuresMode}
          onEnabledChange={setFuturesMode}
          pairs={futuresPairs}
          selectedPair={selectedPair}
          onPairChange={setSelectedPairSymbol}
          direction={futuresDirection}
          onDirectionChange={setFuturesDirection}
          leverage={leverage}
          onLeverageChange={setLeverage}
          margin={futuresMargin}
          onMarginChange={setFuturesMargin}
          currentBalance={account.currentBalance}
          circuitBreakerActive={circuitBreakerActive}
          walletMode={walletMode}
          onOpenTrade={handleOpenFuturesTrade}
        />
        <StatsGrid
          currentBalance={account.currentBalance}
          startingBalance={account.startingBalance}
          totalPnl={account.totalPnl}
          totalPnlPercent={account.totalPnlPercent}
          winRate={account.winRate}
          winningTrades={account.winningTrades}
          losingTrades={account.losingTrades}
          maxDrawdown={account.maxDrawdown}
          currentDrawdown={account.currentDrawdown}
          formatPrice={formatPrice}
        />
        {/* Performance Stats */}
        <PerformanceMetrics stats={stats} />
        {/* Open Positions & History */}
        <Tabs defaultValue="open" className="space-y-4">
          <TabsList className="bg-secondary/50">
            <TabsTrigger value="open">
              Open Positions ({account.openPositions.length})
            </TabsTrigger>
            <TabsTrigger value="history">
              Trade History ({account.tradeHistory.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="open">
            <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
              <CardContent className="pt-6">
                <OpenPositionsTable
                  positions={account.openPositions}
                  onClose={handleCloseTrade}
                  onJournalOpen={(trade) => {
                    setJournalDialog(trade);
                    setJournalNote(trade.notes ?? "");
                  }}
                  formatDate={formatDate}
                  formatPrice={formatPrice}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
              <CardContent className="pt-6">
                <TradeHistoryTable
                  history={account.tradeHistory}
                  onJournalOpen={(trade) => {
                    setJournalDialog(trade);
                    setJournalNote(trade.notes ?? "");
                  }}
                  formatDate={formatDate}
                  formatPrice={formatPrice}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ↓ REMOVED: old trade history table inline JSX replaced by TradeHistoryTable component */}
        </Tabs>
        {/* Equity Curve */}
        <EquityCurve equityCurve={equityCurve} />
        {/* Journal Dialog */}
        <JournalDialog
          trade={journalDialog}
          note={journalNote}
          setNote={setJournalNote}
          onSave={handleAddJournalNote}
          onClose={() => setJournalDialog(null)}
        />
        {/* AI Performance Note */}
        <Card className="mt-8 border-primary/30 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Award className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="font-medium text-foreground">
                  AI Signal Performance
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Trades following AI signals show a{" "}
                  {account.totalTrades > 0
                    ? (
                        (account.winningTrades / account.totalTrades) *
                        100
                      ).toFixed(0)
                    : "0"}
                  % win rate with an average return of +
                  {Math.max(0, (account.avgWin - account.avgLoss) / 2).toFixed(
                    0,
                  )}
                  % per trade. Past performance does not guarantee future
                  results.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add Funds Dialog */}
      <DepositDialog
        open={depositDialog}
        onOpenChange={setDepositDialog}
        depositAmount={depositAmount}
        setDepositAmount={setDepositAmount}
        onDeposit={handleDeposit}
        currentBalance={account.currentBalance}
      />
    </AppLayout>
  );
}
