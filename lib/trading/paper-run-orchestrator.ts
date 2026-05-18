import {
  hydrateAccount,
  normalizeAccount,
  serializeAccount,
} from "@/lib/demo-account";
import { mockCoins } from "@/lib/mock-data";
import { runPaperTradingAutomationTick } from "@/lib/paper-trading-automation";
import {
  listDemoWorkspacesFromSupabase,
  saveDemoWorkspaceForOwner,
  type DemoWorkspaceListResult,
} from "@/lib/supabase-demo";
import type { Scalp1mSnapshot } from "@/lib/trading/paper-scalp-indicators";
import {
  buildMockScalpSnapshots,
  loadPaperScalpSnapshotsResilient,
  resolvePaperScalpSymbols,
} from "@/lib/trading/paper-scalp-klines";
import { computePaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import {
  relayPaperScalpTickTelegram,
  safePaperScalpRouteTelegram,
} from "@/lib/trading/paper-scalp-route-telegram";
import { formatMicroPrice } from "@/lib/trading/micro-price";
import {
  alignPaperScalpWallet,
  paperWalletWasAligned,
  resolvePaperScalpWalletUsd,
} from "@/lib/trading/paper-scalp-wallet";
import {
  writeServerLogAsync,
  writeServerLogFromError,
} from "@/lib/server-logs";
import type { CoinData, DemoAccount } from "@/lib/types";

type TradingAction = "BUY" | "SELL" | "HOLD" | "NO_TRADE";

export type PaperRunOrchestratorResult = {
  ok: true;
  scanned: number;
  updated: number;
  actions: string[];
  symbols: string[];
  snapshotsLoaded: number;
  snapshotSource: "binance" | "mock";
  marketSource: string;
  ranAt: string;
  durationMs: number;
};

function resolveTradingAction(summary: string): TradingAction {
  if (summary.startsWith("opened:")) return "BUY";
  if (summary.startsWith("closed:")) return "SELL";
  if (summary === "holding-position") return "HOLD";
  return "NO_TRADE";
}

function normSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

function logWorkspaceIndicators(
  workspaceKey: string,
  symbols: string[],
  snapshots: Map<string, Scalp1mSnapshot>,
): void {
  for (const raw of symbols) {
    const sym = normSymbol(raw);
    const snap = snapshots.get(sym);
    if (!snap) {
      console.log(
        `[paper-scalp] workspace=${workspaceKey} | ${sym} | indicators=unavailable`,
      );
      continue;
    }
    const cross = snap.bullishCross
      ? "bullish"
      : snap.bearishCross
        ? "bearish"
        : "none";
    console.log(
      `[paper-scalp] workspace=${workspaceKey} | ${sym} | close=${formatMicroPrice(snap.close)} | EMA9=${formatMicroPrice(snap.ema9)} | EMA21=${formatMicroPrice(snap.ema21)} | RSI14=${snap.rsi14.toFixed(1)} | ATR14=${formatMicroPrice(snap.atr14)} | cross=${cross}`,
    );
  }
}

function dispatchRouteTelegram(
  summary: string,
  account: DemoAccount,
  scalpSnapshots: Map<string, Scalp1mSnapshot>,
  marketCoins: CoinData[],
): void {
  try {
    safePaperScalpRouteTelegram(() => {
      relayPaperScalpTickTelegram({
        summary,
        account,
        scalpSnapshots,
        marketCoins,
      });
    });
  } catch (err) {
    console.error("[TELEGRAM-ROUTE-ERROR]", err);
    writeServerLogFromError("paper-scalp-telegram", err, { summary });
  }
}

async function fetchDemoWorkspacesSafe(): Promise<DemoWorkspaceListResult> {
  try {
    console.log("[paper-scalp] Supabase workspace fetch starting…", {
      urlConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    });
    return await listDemoWorkspacesFromSupabase();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("❌ [SUPABASE-WORKSPACE-EXCEPTION]:", err.message);
    writeServerLogFromError("paper-scalp-route", err, {
      phase: "supabase_workspaces",
    });
    return {
      ok: false,
      data: [],
      error: err.message || "Supabase workspace fetch threw",
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
    console.error("[paper-scalp] workspace list failed:", listResult.error);
    writeServerLogAsync({
      level: "error",
      source: "paper-scalp-route",
      message: "workspace_list_failed",
      meta: { detail: listResult.error },
    });
    return {
      ok: false,
      status: 503,
      body: {
        error: listResult.error ?? "Unable to load demo workspaces",
        phase: "supabase_workspaces",
      },
    };
  }

  console.log(
    `[paper-scalp] Supabase OK — loaded ${listResult.data.length} workspace(s)`,
  );

  const marketCoins = mockCoins;
  const openSymbols = listResult.data.flatMap((ws) => {
    const snap = ws.snapshot;
    const active = snap.profiles.find((p) => p.id === snap.activeId);
    const account = active?.payload ? hydrateAccount(active.payload) : null;
    return (account?.openPositions ?? []).map((t) => t.symbol);
  });

  const symbols = resolvePaperScalpSymbols(openSymbols);
  let snapshotSource: "binance" | "mock" = "mock";
  let scalpSnapshots: Map<string, Scalp1mSnapshot>;

  try {
    const loaded = await loadPaperScalpSnapshotsResilient(symbols, marketCoins);
    scalpSnapshots = loaded.snapshots;
    snapshotSource = loaded.source;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[BINANCE-FETCH-BLOCKED]:", err.message);
    writeServerLogFromError("paper-scalp-route", err, {
      phase: "binance_klines",
      symbols,
    });
    scalpSnapshots = buildMockScalpSnapshots(symbols, marketCoins);
    snapshotSource = "mock";
  }

  console.log(
    `[${timestamp}] [paper-scalp] interval=1h snapshots=${scalpSnapshots.size} source=${snapshotSource} symbols=[${symbols.join(", ")}]`,
  );

  let scanned = 0;
  let updated = 0;
  const actions: string[] = [];
  const pendingSaves: Promise<void>[] = [];

  for (const workspace of listResult.data) {
    scanned += 1;
    const workspaceKey = `${workspace.ownerType}:${workspace.ownerId}`;
    const snapshot = workspace.snapshot;

    if (!snapshot.demoAutoPilot || snapshot.walletMode === "real") {
      console.log(
        `[paper-scalp] workspace=${workspaceKey} | skipped (autopilot off or real wallet)`,
      );
      continue;
    }

    const activeProfile = snapshot.profiles.find(
      (profile) => profile.id === snapshot.activeId,
    );
    if (!activeProfile) continue;

    const hydrated = hydrateAccount(activeProfile.payload);
    if (!hydrated) continue;

    const alignedWallet = alignPaperScalpWallet(hydrated);
    const walletReset = paperWalletWasAligned(hydrated, alignedWallet);
    if (walletReset) {
      console.log(
        `[paper-scalp] workspace=${workspaceKey} | wallet realigned to $${resolvePaperScalpWalletUsd()}`,
      );
    }

    logWorkspaceIndicators(workspaceKey, symbols, scalpSnapshots);

    const account = normalizeAccount(alignedWallet);
    const result = runPaperTradingAutomationTick({
      account,
      marketCoins,
      scalpSnapshots,
      autoPilotMode: snapshot.autoPilotMode,
      copyProfile: snapshot.copyProfile,
    });

    const nav = computePaperWorkspaceNav(result.account, marketCoins);
    const action = resolveTradingAction(result.summary);
    console.log(
      `[paper-scalp] workspace=${workspaceKey} | action=${action} | summary=${result.summary} | NAV=$${nav.portfolio_nav_usdt.toFixed(2)} | cash=$${nav.available_usdt.toFixed(2)}`,
    );

    dispatchRouteTelegram(
      result.summary,
      result.account,
      scalpSnapshots,
      marketCoins,
    );

    if (!result.changed && !walletReset) continue;

    const accountToPersist = result.changed ? result.account : account;
    const nextProfiles = snapshot.profiles.map((profile) =>
      profile.id === snapshot.activeId
        ? { ...profile, payload: serializeAccount(accountToPersist) }
        : profile,
    );

    pendingSaves.push(
      saveDemoWorkspaceForOwner(workspace.ownerType, workspace.ownerId, {
        ...snapshot,
        profiles: nextProfiles,
      }).then((saveResult) => {
        if (!saveResult.ok) {
          actions.push(`save-failed:${workspaceKey}`);
          writeServerLogAsync({
            level: "error",
            source: "paper-scalp-route",
            message: "workspace_save_failed",
            meta: { workspaceKey, detail: saveResult.error },
          });
          return;
        }
        updated += 1;
        actions.push(
          walletReset && !result.changed
            ? `${workspaceKey}:wallet-reset-$${resolvePaperScalpWalletUsd()}`
            : `${workspaceKey}:${result.summary}`,
        );
      }),
    );
  }

  await Promise.all(pendingSaves);

  const durationMs = Number((performance.now() - startTime).toFixed(2));
  console.log(
    `[${timestamp}] ✅ 1h tick completed in ${durationMs}ms | scanned=${scanned} updated=${updated}`,
  );

  return {
    ok: true,
    scanned,
    updated,
    actions,
    symbols,
    snapshotsLoaded: scalpSnapshots.size,
    snapshotSource,
    marketSource: "mockCoins",
    ranAt: new Date().toISOString(),
    durationMs,
  };
}
