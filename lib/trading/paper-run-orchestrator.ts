import { serializeAccount } from "@/lib/demo-account";
import { runPaperTradingAutomationTick } from "@/lib/paper-trading-automation";
import {
  listDemoWorkspacesFromSupabase,
  type DemoWorkspaceRecord,
} from "@/lib/supabase-demo";
import { queuePaperWorkspacePersist } from "@/lib/trading/paper-run-persist";
import { logPaperMarketScan, logPaperWorkspaceResult } from "@/lib/trading/paper-scalp-active-log";
import { computePaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import {
  resolvePaperMomentumSettings,
} from "@/lib/trading/paper-scalp-momentum";
import { preparePaperRun } from "@/lib/trading/paper-run-prepared";
import {
  isPaperRunBudgetExceeded,
  PAPER_RUN_BUDGET_MS,
  remainingPaperRunBudgetMs,
} from "@/lib/trading/paper-run-budget";
import {
  alignPaperScalpWallet,
  paperWalletWasAligned,
  resolvePaperScalpWalletUsd,
} from "@/lib/trading/paper-scalp-wallet";
import {
  relayPaperScalpTickTelegram,
  safePaperScalpRouteTelegram,
} from "@/lib/trading/paper-scalp-route-telegram";
import {
  writeServerLogAsync,
  writeServerLogFromError,
} from "@/lib/server-logs";

export type PaperRunOrchestratorResult = {
  ok: true;
  scanned: number;
  updated: number;
  actions: string[];
  symbols: string[];
  snapshotsLoaded: number;
  snapshotSource: "binance" | "mock";
  marketSource: "1h-snapshots" | "mock-fallback" | "mixed";
  ranAt: string;
  durationMs: number;
  partial?: boolean;
  partialReason?: string;
  workspacesSkipped?: number;
  persistAsync?: boolean;
  persistQueued?: number;
};

function resolveTradingAction(summary: string): string {
  if (summary.startsWith("opened:")) return "BUY";
  if (summary.startsWith("closed:")) return "SELL";
  if (summary === "holding-position") return "HOLD";
  return "NO_TRADE";
}

function dispatchRouteTelegram(
  summary: string,
  account: Parameters<typeof relayPaperScalpTickTelegram>[0]["account"],
  scalpSnapshots: Parameters<typeof relayPaperScalpTickTelegram>[0]["scalpSnapshots"],
  marketCoins: Parameters<typeof relayPaperScalpTickTelegram>[0]["marketCoins"],
): void {
  try {
    safePaperScalpRouteTelegram(() => {
      relayPaperScalpTickTelegram({ summary, account, scalpSnapshots, marketCoins });
    });
  } catch (err) {
    writeServerLogFromError("paper-scalp-telegram", err, { summary });
  }
}

async function fetchDemoWorkspacesSafe() {
  try {
    return await listDemoWorkspacesFromSupabase();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    writeServerLogFromError("paper-scalp-route", err, { phase: "supabase_workspaces" });
    return {
      ok: false as const,
      data: [] as DemoWorkspaceRecord[],
      error: err.message,
    };
  }
}

export async function runPaperScalpOrchestrator(): Promise<
  | { ok: false; status: number; body: Record<string, unknown> }
  | PaperRunOrchestratorResult
> {
  const startTime = performance.now();
  const timestamp = new Date().toISOString();

  const listResult = await fetchDemoWorkspacesSafe();
  if (!listResult.ok) {
    return {
      ok: false,
      status: 503,
      body: { error: listResult.error ?? "Unable to load demo workspaces" },
    };
  }

  console.log(
    `[paper-scalp] Supabase OK — loaded ${listResult.data.length} workspace(s) | budget=${PAPER_RUN_BUDGET_MS}ms`,
  );

  if (isPaperRunBudgetExceeded(startTime)) {
    return buildPartialResult(startTime, {
      scanned: 0,
      updated: 0,
      actions: ["budget_exceeded:pre_prepare"],
      symbols: [],
      snapshotsLoaded: 0,
      snapshotSource: "mock",
      marketSource: "mock-fallback",
      partialReason: "deadline_before_klines",
      workspacesSkipped: listResult.data.length,
    });
  }

  const prepared = await preparePaperRun(listResult.data);
  const sampleSettings = listResult.data[0]?.snapshot.paperSettings;
  const momentum = resolvePaperMomentumSettings(
    sampleSettings ?? {},
    Number(process.env.PAPER_RSI_MAX_BUY ?? 70),
  );

  logPaperMarketScan(prepared.symbols, prepared.scalpSnapshots, momentum);

  console.log(
    `[${timestamp}] [paper-scalp] snapshots=${prepared.scalpSnapshots.size} source=${prepared.snapshotSource} marks=${prepared.marketSource} | remaining=${remainingPaperRunBudgetMs(startTime).toFixed(0)}ms`,
  );

  let scanned = 0;
  let updated = 0;
  let persistQueued = 0;
  let workspacesSkipped = 0;
  const actions: string[] = [];
  let partial = false;
  let partialReason: string | undefined;

  for (const workspace of listResult.data) {
    if (isPaperRunBudgetExceeded(startTime)) {
      partial = true;
      partialReason = "execution_budget_hot_path";
      workspacesSkipped = listResult.data.length - scanned;
      console.warn(
        `[paper-scalp] ${PAPER_RUN_BUDGET_MS}ms hot-path budget hit — partial return (${workspacesSkipped} workspace(s) skipped)`,
      );
      break;
    }

    scanned += 1;
    const key = `${workspace.ownerType}:${workspace.ownerId}`;
    const snapshot = workspace.snapshot;

    if (!snapshot.demoAutoPilot || snapshot.walletMode === "real") {
      continue;
    }

    const cached = prepared.accountByKey.get(key);
    if (!cached) continue;

    const alignedWallet = alignPaperScalpWallet(cached.account);
    const walletReset = paperWalletWasAligned(cached.account, alignedWallet);

    const result = runPaperTradingAutomationTick({
      account: alignedWallet,
      marketCoins: prepared.marketCoins,
      scalpSnapshots: prepared.scalpSnapshots,
      autoPilotMode: cached.autoPilotMode,
      copyProfile: cached.copyProfile,
      paperSettings: cached.paperSettings,
    });

    const nav = computePaperWorkspaceNav(result.account, prepared.marketCoins);
    const action = resolveTradingAction(result.summary);
    logPaperWorkspaceResult({
      workspaceKey: key,
      action,
      summary: result.summary,
      navUsdt: nav.portfolio_nav_usdt,
      cashUsdt: nav.available_usdt,
    });

    dispatchRouteTelegram(
      result.summary,
      result.account,
      prepared.scalpSnapshots,
      prepared.marketCoins,
    );

    if (!result.changed && !walletReset) continue;

    const accountToPersist = result.changed ? result.account : alignedWallet;
    const nextProfiles = snapshot.profiles.map((profile) =>
      profile.id === snapshot.activeId
        ? { ...profile, payload: serializeAccount(accountToPersist) }
        : profile,
    );

    persistQueued += 1;
    const persistSnapshot = { ...snapshot, profiles: nextProfiles };
    const actionLabel =
      walletReset && !result.changed
        ? `${key}:wallet-reset-$${resolvePaperScalpWalletUsd()}`
        : `${key}:${result.summary}`;
    actions.push(actionLabel);
    updated += 1;

    queuePaperWorkspacePersist({
      ownerType: workspace.ownerType,
      ownerId: workspace.ownerId,
      workspaceKey: key,
      snapshot: persistSnapshot,
      onSettled: (outcome) => {
        if (!outcome.ok) {
          console.warn("[paper-scalp] background persist failed", outcome);
        }
      },
    });
  }

  return buildPartialResult(startTime, {
    scanned,
    updated,
    actions,
    symbols: prepared.symbols,
    snapshotsLoaded: prepared.scalpSnapshots.size,
    snapshotSource: prepared.snapshotSource,
    marketSource: prepared.marketSource,
    partial,
    partialReason,
    workspacesSkipped: partial ? workspacesSkipped : 0,
    persistAsync: persistQueued > 0,
    persistQueued,
  });
}

function buildPartialResult(
  startTime: number,
  fields: Omit<PaperRunOrchestratorResult, "ok" | "ranAt" | "durationMs">,
): PaperRunOrchestratorResult {
  const durationMs = Number((performance.now() - startTime).toFixed(2));
  console.log(
    `✅ paper tick ${fields.partial ? "PARTIAL" : "complete"} in ${durationMs}ms | scanned=${fields.scanned} updated=${fields.updated}`,
  );
  return {
    ok: true,
    ranAt: new Date().toISOString(),
    durationMs,
    ...fields,
  };
}
