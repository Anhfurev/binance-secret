import { serializeAccount } from "@/lib/demo-account";
import { runPaperTradingAutomationTick } from "@/lib/paper-trading-automation";
import {
  listDemoWorkspacesFromSupabase,
  type DemoWorkspaceRecord,
} from "@/lib/supabase-demo";
import {
  scheduleUnifiedEngineManifestDispatch,
  type EngineManifestInput,
  type WorkspaceTickRow,
} from "@/lib/trading/paper-scalp-engine-manifest";
import { evaluateManifestTelegramDispatch } from "@/lib/trading/paper-scalp-manifest-notify";
import {
  calculateDynamicRegime,
  resolveBtcCandles,
  resolveBtcSnapshot,
} from "@/lib/trading/paper-scalp-regime";
import {
  enrichNavWithDbMetrics,
  recordPaperPortfolioSnapshot,
} from "@/lib/trading/paper-portfolio-db";
import { resolvePaperEngineMode } from "@/lib/trading/paper-scalp-engine-mode";
import {
  computePaperWorkspaceNav,
  formatNavLogLine,
} from "@/lib/trading/paper-scalp-nav";
import { resolvePaperMomentumSettings } from "@/lib/trading/paper-scalp-momentum";
import { preparePaperRun } from "@/lib/trading/paper-run-prepared";
import { queuePaperWorkspacePersist } from "@/lib/trading/paper-run-persist";
import { syncPaperTradeImmediately } from "@/lib/trading/paper-trades-sync";
import {
  isPaperRunBudgetExceeded,
  PAPER_RUN_BUDGET_MS,
} from "@/lib/trading/paper-run-budget";
import { resolvePaperTelegramMasterWorkspaceKey } from "@/lib/trading/paper-scalp-notify-gate";
import { sendPaperEngineCrashAlert } from "@/lib/trading/paper-scalp-telegram-crash";
import {
  alignPaperScalpWallet,
  paperWalletWasAligned,
  resolvePaperScalpWalletUsd,
} from "@/lib/trading/paper-scalp-wallet";
import { writeServerLogFromError } from "@/lib/server-logs";
import type { DemoAccount } from "@/lib/types";

export type PaperRunOrchestratorResult = {
  ok: true;
  scanned: number;
  updated: number;
  actions: string[];
  symbols: string[];
  snapshotsLoaded: number;
  snapshotSource: "binance" | "mock";
  marketSource: "15m-snapshots" | "mock-fallback" | "mixed";
  ranAt: string;
  durationMs: number;
  partial?: boolean;
  partialReason?: string;
  workspacesSkipped?: number;
  persistAsync?: boolean;
  persistQueued?: number;
};

function resolveTradingAction(summary: string): string {
  if (summary.startsWith("opened-short:")) return "SHORT";
  if (summary.startsWith("opened:")) return "BUY";
  if (summary.startsWith("closed:")) return "SELL";
  if (summary.includes("micro-acceleration")) return "BUY";
  if (summary === "drawdown-pause-24h") return "PAUSED";
  if (summary.startsWith("velocity-tp-70:")) return "VELOCITY_TP";
  if (summary === "pyramid-layer-added") return "PYRAMID";
  if (summary === "holding-position") return "HOLD";
  return "NO_TRADE";
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

/**
 * Paper run: prepare 15m harvest → per-workspace alpha tick (all legs, no early exit skip)
 * → persist → Telegram only on high-signal or ULAT 10m pulse (see manifest-notify).
 * Velocity wake: route sets x-paper-velocity-wake:1 → skips 120s heartbeat interval.
 */
async function executePaperScalpOrchestrator(): Promise<
  | { ok: false; status: number; body: Record<string, unknown> }
  | PaperRunOrchestratorResult
> {
  const startTime = performance.now();

  const listResult = await fetchDemoWorkspacesSafe();
  if (!listResult.ok) {
    return {
      ok: false,
      status: 503,
      body: { error: listResult.error ?? "Unable to load demo workspaces" },
    };
  }

  const masterWorkspaceKey = resolvePaperTelegramMasterWorkspaceKey(
    listResult.data,
  );

  if (listResult.data.length === 0) {
    return buildPartialResult(startTime, {
      scanned: 0,
      updated: 0,
      actions: ["no_workspaces"],
      symbols: [],
      snapshotsLoaded: 0,
      snapshotSource: "mock",
      marketSource: "mock-fallback",
    });
  }

  const prepared = await preparePaperRun(listResult.data);
  const workspaceBudgetStart = performance.now();
  console.log(
    `[paper-scalp] orchestrator engine=${prepared.engineMode} snapshots=${prepared.scalpSnapshots.size} accounts=${prepared.accountByKey.size}`,
  );
  const sampleSettings = listResult.data[0]?.snapshot.paperSettings;
  const momentum = resolvePaperMomentumSettings(
    sampleSettings ?? {},
    Number(process.env.PAPER_RSI_MAX_BUY ?? 70),
  );

  let scanned = 0;
  let updated = 0;
  let persistQueued = 0;
  let workspacesSkipped = 0;
  const actions: string[] = [];
  const workspaceRows: WorkspaceTickRow[] = [];
  let partial = false;
  let partialReason: string | undefined;
  let masterAccount: DemoAccount | null = null;
  let masterSummary = "no-tick";
  let pyramidedAny = false;
  let positionClosedAny = false;
  let velocityPartialAny = false;
  let entryAny = false;
  const workspaceSummaries: string[] = [];

  for (const workspace of listResult.data) {
    if (isPaperRunBudgetExceeded(workspaceBudgetStart)) {
      partial = true;
      partialReason = "execution_budget_hot_path";
      workspacesSkipped = listResult.data.length - scanned;
      if (process.env.PAPER_DEBUG === "1") {
        console.log(
          `[paper-scalp] ${PAPER_RUN_BUDGET_MS}ms workspace budget — partial (${workspacesSkipped} skipped)`,
        );
      }
      break;
    }

    scanned += 1;
    const key = `${workspace.ownerType}:${workspace.ownerId}`;
    const snapshot = workspace.snapshot;

    if (!snapshot.demoAutoPilot || snapshot.walletMode === "real") {
      continue;
    }

    const cached = prepared.accountByKey.get(key);
    if (!cached) {
      console.warn("[paper-scalp] skip workspace — not in prepared.accountByKey", {
        key,
        engineMode: prepared.engineMode,
      });
      continue;
    }

    const dbCtx = prepared.dbCtxByKey.get(key) ?? cached.dbCtx;
    const alignedWallet = alignPaperScalpWallet(cached.account, {
      persistedStartingBalance: dbCtx?.metrics?.sessionBaselineUsdt,
    });
    const walletReset = paperWalletWasAligned(cached.account, alignedWallet);

    const result = await runPaperTradingAutomationTick({
      account: alignedWallet,
      marketCoins: prepared.marketCoins,
      scalpSnapshots: prepared.scalpSnapshots,
      candlesBySymbol: prepared.candlesBySymbol,
      candles1m: prepared.candles1mBySymbol,
      candles3m: prepared.candles3mBySymbol,
      apiDegraded: prepared.apiDegraded,
      autoPilotMode: cached.autoPilotMode,
      copyProfile: cached.copyProfile,
      paperSettings: cached.paperSettings,
      workspaceKey: key,
      ownerType: workspace.ownerType,
      ownerId: workspace.ownerId,
      userId: prepared.dbCtxByKey.get(key)?.userId,
      dbCtx: prepared.dbCtxByKey.get(key) ?? undefined,
    });

    const nav = enrichNavWithDbMetrics(
      computePaperWorkspaceNav(result.account, prepared.marketCoins),
      dbCtx?.metrics ?? null,
    );
    const action = resolveTradingAction(result.summary);

    if (key === masterWorkspaceKey || workspaceRows.length === 0) {
      console.log(`[PORTFOLIO NAV] ${key} ${formatNavLogLine(nav)}`);
    }
    workspaceSummaries.push(result.summary);

    if (result.pyramided) pyramidedAny = true;
    const closedThisTick =
      result.positionClosed || result.summary.startsWith("closed:");
    if (closedThisTick) {
      positionClosedAny = true;
      const closedLeg = result.account.tradeHistory[0];
      if (closedLeg && dbCtx) {
        void syncPaperTradeImmediately({
          ownerType: workspace.ownerType,
          ownerId: workspace.ownerId,
          workspaceKey: key,
          trade: closedLeg,
        });
        void recordPaperPortfolioSnapshot({ ctx: dbCtx, nav });
      }
    }
    if (result.velocityPartial || result.summary.startsWith("velocity-tp-70:")) {
      velocityPartialAny = true;
    }
    if (
      result.entryExecuted ||
      result.summary.startsWith("opened:") ||
      result.summary.startsWith("opened-short:")
    ) {
      entryAny = true;
    }

    workspaceRows.push({
      workspaceKey: key,
      action,
      summary: result.summary,
      nav,
      openLegCount: result.account.openPositions.length,
    });

    if (key === masterWorkspaceKey || (!masterAccount && workspaceRows.length === 1)) {
      masterAccount = result.account;
      masterSummary = result.summary;
    }

    if (!result.changed && !walletReset) continue;

    const accountToPersist = result.changed ? result.account : alignedWallet;
    const nextProfiles = snapshot.profiles.map((profile) =>
      profile.id === snapshot.activeId
        ? { ...profile, payload: serializeAccount(accountToPersist) }
        : profile,
    );

    persistQueued += 1;
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
      account: accountToPersist,
      dbCtx,
      marketCoins: prepared.marketCoins,
      snapshot: { ...snapshot, profiles: nextProfiles },
      onSettled: (outcome) => {
        if (!outcome.ok) {
          console.warn("[paper-scalp] background persist failed", outcome);
        }
      },
    });
  }

  const btcRegimeActive =
    prepared.apiDegraded ||
    !resolveBtcSnapshot(prepared.scalpSnapshots) ||
    calculateDynamicRegime({
      btcSnapshot: resolveBtcSnapshot(prepared.scalpSnapshots),
      btcCandles: resolveBtcCandles(prepared.candlesBySymbol),
      apiDegraded: prepared.apiDegraded,
    }).blockAltcoinEntries;

  const outcome = buildPartialResult(startTime, {
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

  const notify = evaluateManifestTelegramDispatch({
    ranAt: outcome.ranAt,
    actions,
    workspaceSummaries,
    pyramidedAny,
    positionClosedAny,
    velocityPartialAny,
    entryAny,
  });

  const manifest = buildManifestPayload(outcome, {
    masterWorkspaceKey,
    masterAccount,
    masterSummary,
    workspaceRows,
    momentum,
    scalpSnapshots: prepared.scalpSnapshots,
    candlesBySymbol: prepared.candlesBySymbol,
    marketCoins: prepared.marketCoins,
    symbols: prepared.symbols,
    btcRegimeActive,
    apiDegraded: prepared.apiDegraded,
    tacticalPulseSummary: notify.reason === "tactical_pulse",
  });

  return finalizePaperTickRun(outcome, manifest, notify);
}

/** Sync return — Telegram on high-signal or ULAT 10m tactical pulse. */
function finalizePaperTickRun(
  outcome: PaperRunOrchestratorResult,
  manifest: EngineManifestInput,
  notify: ReturnType<typeof evaluateManifestTelegramDispatch>,
): PaperRunOrchestratorResult {
  if (notify.dispatch) {
    scheduleUnifiedEngineManifestDispatch(manifest, { verboseLog: true });
    console.log(
      `[paper-scalp-manifest] dispatched (${notify.reason}) | ${outcome.durationMs.toFixed(0)}ms`,
    );
  } else {
    console.log(
      `[paper-scalp-manifest] silent scan completed | ${outcome.durationMs.toFixed(0)}ms | scanned=${outcome.scanned}`,
    );
  }
  return outcome;
}

function buildManifestPayload(
  outcome: PaperRunOrchestratorResult,
  ctx: {
    masterWorkspaceKey: string | null;
    masterAccount: DemoAccount | null;
    masterSummary: string;
    workspaceRows: WorkspaceTickRow[];
    momentum: EngineManifestInput["momentum"];
    scalpSnapshots: EngineManifestInput["scalpSnapshots"];
    candlesBySymbol: EngineManifestInput["candlesBySymbol"];
    marketCoins: EngineManifestInput["marketCoins"];
    symbols: string[];
    btcRegimeActive: boolean;
    apiDegraded: boolean;
    tacticalPulseSummary?: boolean;
  },
): EngineManifestInput {
  return {
    ranAt: outcome.ranAt,
    durationMs: outcome.durationMs,
    partial: outcome.partial ?? false,
    partialReason: outcome.partialReason,
    snapshotSource: outcome.snapshotSource,
    marketSource: outcome.marketSource,
    snapshotsLoaded: outcome.snapshotsLoaded,
    symbols: ctx.symbols,
    scalpSnapshots: ctx.scalpSnapshots,
    candlesBySymbol: ctx.candlesBySymbol,
    marketCoins: ctx.marketCoins,
    momentum: ctx.momentum,
    masterWorkspaceKey: ctx.masterWorkspaceKey,
    masterAccount: ctx.masterAccount,
    masterSummary: ctx.masterSummary,
    workspaceRows: ctx.workspaceRows,
    actions: outcome.actions,
    scanned: outcome.scanned,
    updated: outcome.updated,
    persistQueued: outcome.persistQueued ?? 0,
    btcRegimeActive: ctx.btcRegimeActive,
    apiDegraded: ctx.apiDegraded,
    tacticalPulseSummary: ctx.tacticalPulseSummary,
  };
}

function buildPartialResult(
  startTime: number,
  fields: Omit<PaperRunOrchestratorResult, "ok" | "ranAt" | "durationMs">,
): PaperRunOrchestratorResult {
  const durationMs = Number((performance.now() - startTime).toFixed(2));
  return {
    ok: true,
    ranAt: new Date().toISOString(),
    durationMs,
    ...fields,
  };
}

export async function runPaperScalpOrchestrator(): Promise<
  | { ok: false; status: number; body: Record<string, unknown> }
  | PaperRunOrchestratorResult
> {
  try {
    return await executePaperScalpOrchestrator();
  } catch (error: unknown) {
    sendPaperEngineCrashAlert(error);
    writeServerLogFromError("paper-scalp-orchestrator", error, {
      phase: "engine_crash",
    });
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[paper-scalp-orchestrator] tick failed (non-fatal to process)", {
      message: err.message,
    });
    return buildPartialResult(performance.now(), {
      scanned: 0,
      updated: 0,
      actions: [`engine-error:${err.message.slice(0, 120)}`],
      symbols: [],
      snapshotsLoaded: 0,
      snapshotSource: "mock",
      marketSource: "mock-fallback",
      partial: true,
      partialReason: "orchestrator_exception",
    });
  }
}
