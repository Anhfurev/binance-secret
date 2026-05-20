import { hydrateAccount, normalizeAccount } from "@/lib/demo-account";
import { mockCoins } from "@/lib/mock-data";
import type { DemoWorkspaceRecord } from "@/lib/supabase-demo";
import type { Scalp1mSnapshot, ScalpCandle } from "@/lib/trading/paper-scalp-indicators";
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
  accountByKey: Map<string, CachedWorkspaceAccount>;
  dbCtxByKey: Map<string, PaperWorkspaceDbCtx>;
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

  try {
    const loaded = await loadPaperScalpSnapshotsResilient(symbols, mockCoins);
    scalpSnapshots = loaded.snapshots;
    candlesBySymbol = loaded.candlesBySymbol;
    snapshotSource = loaded.source;
    apiDegraded = loaded.source === "mock" || loaded.snapshots.size === 0;
  } catch {
    scalpSnapshots = buildMockScalpSnapshots(symbols, mockCoins);
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
    if (!hydrated) return;

    const dbCtx = await loadPaperWorkspaceDbContext({
      ownerType: ws.ownerType,
      ownerId: ws.ownerId,
      workspaceKey: key,
    });
    if (dbCtx) dbCtxByKey.set(key, dbCtx);

    const merged = await mergePaperAccountFromDatabase({
      account: normalizeAccount(hydrated),
      ctx: dbCtx,
    });

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

  return {
    workspaces,
    symbols,
    scalpSnapshots,
    candlesBySymbol,
    marketCoins,
    snapshotSource,
    marketSource,
    apiDegraded,
    accountByKey,
    dbCtxByKey,
  };
}
