import { hydrateAccount, normalizeAccount } from "@/lib/demo-account";
import { mockCoins } from "@/lib/mock-data";
import type { DemoWorkspaceRecord } from "@/lib/supabase-demo";
import type { Scalp1mSnapshot, ScalpCandle } from "@/lib/trading/paper-scalp-indicators";
import {
  resolvePaperEngineMode,
  type PaperEngineMode,
} from "@/lib/trading/paper-scalp-engine-mode";
import {
  buildMockMicroHarvest,
  harvestMicroCandlesParallel,
} from "@/lib/trading/paper-scalp-micro-klines";
import {
  buildMockScalpSnapshots,
  loadPaperScalpSnapshotsResilient,
  resolvePaperScalpSymbols,
} from "@/lib/trading/paper-scalp-klines";
import { buildPaperScalpMarketCoins } from "@/lib/trading/paper-scalp-market";
import { extractPaperWatchSymbolsFromWorkspaces } from "@/lib/trading/paper-scalp-settings";
import {
  loadPaperWorkspaceDbContext,
  mergePaperAccountFromDatabase,
  type PaperWorkspaceDbCtx,
} from "@/lib/trading/paper-portfolio-db";
import { mergeAccountWithLiveProfile } from "@/lib/trading/paper-profile-live";
import { resolvePaperTradesUserId } from "@/lib/trading/paper-db-user";
import { logPaperDbBinding } from "@/lib/trading/paper-trades-db-safe";
import type { CoinData, DemoAccount } from "@/lib/types";

export type CachedWorkspaceAccount = {
  workspaceKey: string;
  account: DemoAccount;
  dbCtx: PaperWorkspaceDbCtx | null;
  paperSettings: DemoWorkspaceRecord["snapshot"]["paperSettings"];
  autoPilotMode: DemoWorkspaceRecord["snapshot"]["autoPilotMode"];
  copyProfile: DemoWorkspaceRecord["snapshot"]["copyProfile"];
  demoAutoPilot: boolean;
  walletMode: DemoWorkspaceRecord["snapshot"]["walletMode"];
};

export type PreparedPaperRun = {
  workspaces: DemoWorkspaceRecord[];
  symbols: string[];
  scalpSnapshots: Map<string, Scalp1mSnapshot>;
  candlesBySymbol: Map<string, ScalpCandle[]>;
  marketCoins: CoinData[];
  snapshotSource: "binance" | "mock";
  marketSource: "15m-snapshots" | "mock-fallback" | "mixed";
  apiDegraded: boolean;
  engineMode: PaperEngineMode;
  accountByKey: Map<string, CachedWorkspaceAccount>;
  dbCtxByKey: Map<string, PaperWorkspaceDbCtx>;
  candles1mBySymbol: Map<string, ScalpCandle[]>;
  candles3mBySymbol: Map<string, ScalpCandle[]>;
};

function workspaceKey(ws: DemoWorkspaceRecord): string {
  return `${ws.ownerType}:${ws.ownerId}`;
}

/** Single Supabase list + one 15m kline harvest — reused across workspace ticks. */
export async function preparePaperRun(
  workspaces: DemoWorkspaceRecord[],
): Promise<PreparedPaperRun> {
  const openSymbols = workspaces.flatMap((ws) => {
    const snap = ws.snapshot;
    const active = snap.profiles.find((p) => p.id === snap.activeId);
    const account = active?.payload ? hydrateAccount(active.payload) : null;
    return (account?.openPositions ?? []).map((t) => t.symbol);
  });

  const workspaceSymbols = extractPaperWatchSymbolsFromWorkspaces(workspaces);
  const symbols = resolvePaperScalpSymbols(openSymbols, workspaceSymbols);

  let snapshotSource: "binance" | "mock" = "mock";
  let apiDegraded = true;
  let scalpSnapshots: Map<string, Scalp1mSnapshot>;
  let candlesBySymbol = new Map<string, ScalpCandle[]>();

  const engineMode = resolvePaperEngineMode();
  const microMode = engineMode === "micro";
  let candles1mBySymbol = new Map<string, ScalpCandle[]>();
  let candles3mBySymbol = new Map<string, ScalpCandle[]>();

  logPaperDbBinding();
  console.log(
    `[preparePaperRun] engine=${engineMode} workspaces=${workspaces.length} symbols=${symbols.length}`,
  );

  try {
    const loaded = microMode
      ? await harvestMicroCandlesParallel(symbols)
      : await loadPaperScalpSnapshotsResilient(symbols, mockCoins);
    scalpSnapshots = loaded.snapshots;
    candlesBySymbol = loaded.candlesBySymbol;
    snapshotSource = loaded.source;
    apiDegraded = loaded.source === "mock" || loaded.snapshots.size === 0;
    if (microMode && "candles1m" in loaded) {
      candles1mBySymbol = loaded.candles1m;
      candles3mBySymbol = loaded.candles3m;
    }
    if (microMode && loaded.snapshots.size === 0) {
      const mock = buildMockMicroHarvest(symbols, mockCoins);
      scalpSnapshots = mock.snapshots;
      candlesBySymbol = mock.candlesBySymbol;
      candles1mBySymbol = mock.candlesBySymbol;
      snapshotSource = "mock";
      apiDegraded = true;
    }
  } catch {
    if (microMode) {
      const mock = buildMockMicroHarvest(symbols, mockCoins);
      scalpSnapshots = mock.snapshots;
      candlesBySymbol = mock.candlesBySymbol;
      candles1mBySymbol = mock.candlesBySymbol;
    } else {
      scalpSnapshots = buildMockScalpSnapshots(symbols, mockCoins);
    }
    snapshotSource = "mock";
    apiDegraded = true;
  }

  const { coins: marketCoins, marketSource } = buildPaperScalpMarketCoins(
    scalpSnapshots,
    { fallback: mockCoins, requiredSymbols: [...symbols, ...openSymbols] },
  );

  const accountByKey = new Map<string, CachedWorkspaceAccount>();
  const dbCtxByKey = new Map<string, PaperWorkspaceDbCtx>();

  const hydrateJobs = workspaces.map(async (ws) => {
    const key = workspaceKey(ws);
    const snap = ws.snapshot;
    const active = snap.profiles.find((p) => p.id === snap.activeId);
    const hydrated = active?.payload ? hydrateAccount(active.payload) : null;
    if (!hydrated) {
      console.warn("[preparePaperRun] skip workspace — no active profile payload", {
        workspaceKey: key,
        activeId: snap.activeId,
      });
      return;
    }

    const dbCtx = await loadPaperWorkspaceDbContext({
      ownerType: ws.ownerType,
      ownerId: ws.ownerId,
      workspaceKey: key,
    });
    if (dbCtx) dbCtxByKey.set(key, dbCtx);

    let merged = await mergePaperAccountFromDatabase({
      account: normalizeAccount(hydrated),
      ctx: dbCtx,
    });

    const userId = resolvePaperTradesUserId(ws.ownerType, ws.ownerId);
    if (userId) {
      merged = await mergeAccountWithLiveProfile(userId, merged);
    }

    accountByKey.set(key, {
      workspaceKey: key,
      account: merged,
      dbCtx,
      paperSettings: snap.paperSettings,
      autoPilotMode: snap.autoPilotMode,
      copyProfile: snap.copyProfile,
      demoAutoPilot: snap.demoAutoPilot,
      walletMode: snap.walletMode,
    });
  });

  await Promise.all(hydrateJobs);

  console.log(
    `[preparePaperRun] ready engine=${engineMode} accounts=${accountByKey.size} snapshots=${scalpSnapshots.size} source=${snapshotSource}`,
  );

  return {
    workspaces,
    symbols,
    scalpSnapshots,
    candlesBySymbol,
    marketCoins,
    snapshotSource,
    marketSource,
    apiDegraded,
    engineMode,
    accountByKey,
    dbCtxByKey,
    candles1mBySymbol,
    candles3mBySymbol,
  };
}
