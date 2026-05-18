import { hydrateAccount, normalizeAccount } from "@/lib/demo-account";
import { mockCoins } from "@/lib/mock-data";
import type { DemoWorkspaceRecord } from "@/lib/supabase-demo";
import type { Scalp1mSnapshot } from "@/lib/trading/paper-scalp-indicators";
import {
  buildMockScalpSnapshots,
  loadPaperScalpSnapshotsResilient,
  resolvePaperScalpSymbols,
} from "@/lib/trading/paper-scalp-klines";
import { buildPaperScalpMarketCoins } from "@/lib/trading/paper-scalp-market";
import { extractPaperWatchSymbolsFromWorkspaces } from "@/lib/trading/paper-scalp-settings";
import type { CoinData, DemoAccount } from "@/lib/types";

export type CachedWorkspaceAccount = {
  workspaceKey: string;
  account: DemoAccount;
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
  marketCoins: CoinData[];
  snapshotSource: "binance" | "mock";
  marketSource: "1h-snapshots" | "mock-fallback" | "mixed";
  accountByKey: Map<string, CachedWorkspaceAccount>;
};

function workspaceKey(ws: DemoWorkspaceRecord): string {
  return `${ws.ownerType}:${ws.ownerId}`;
}

/** Single Supabase list + one kline harvest — reused across workspace ticks. */
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
  let scalpSnapshots: Map<string, Scalp1mSnapshot>;
  try {
    const loaded = await loadPaperScalpSnapshotsResilient(symbols, mockCoins);
    scalpSnapshots = loaded.snapshots;
    snapshotSource = loaded.source;
  } catch {
    scalpSnapshots = buildMockScalpSnapshots(symbols, mockCoins);
    snapshotSource = "mock";
  }

  const { coins: marketCoins, marketSource } = buildPaperScalpMarketCoins(
    scalpSnapshots,
    { fallback: mockCoins, requiredSymbols: [...symbols, ...openSymbols] },
  );

  const accountByKey = new Map<string, CachedWorkspaceAccount>();
  for (const ws of workspaces) {
    const key = workspaceKey(ws);
    const snap = ws.snapshot;
    const active = snap.profiles.find((p) => p.id === snap.activeId);
    const hydrated = active?.payload ? hydrateAccount(active.payload) : null;
    if (!hydrated) continue;
    accountByKey.set(key, {
      workspaceKey: key,
      account: normalizeAccount(hydrated),
      paperSettings: snap.paperSettings,
      autoPilotMode: snap.autoPilotMode,
      copyProfile: snap.copyProfile,
      demoAutoPilot: snap.demoAutoPilot,
      walletMode: snap.walletMode,
    });
  }

  return {
    workspaces,
    symbols,
    scalpSnapshots,
    marketCoins,
    snapshotSource,
    marketSource,
    accountByKey,
  };
}
