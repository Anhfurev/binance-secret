export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
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
import type { CoinData } from "@/lib/types";

type TradingAction = "BUY" | "SELL" | "HOLD" | "NO_TRADE";

function logFatalRouteException(error: unknown, phase?: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error("❌ [FATAL ROUTE EXCEPTION] LOG DETAILS:", {
    message: err?.message,
    stack: err?.stack,
    cause: err?.cause,
  });
  writeServerLogFromError("paper-scalp-route", err, {
    phase: phase ?? "fatal_route_exception",
  });
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function resolveMarketCoins(): CoinData[] {
  return mockCoins;
}

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
      `[paper-scalp] workspace=${workspaceKey} | ${sym} | close=${formatMicroPrice(snap.close)} | EMA9=${formatMicroPrice(snap.ema9)} | EMA21=${formatMicroPrice(snap.ema21)} | ATR14=${formatMicroPrice(snap.atr14)} | cross=${cross}`,
    );
  }
}

function dispatchRouteTelegram(
  summary: string,
  account: ReturnType<typeof normalizeAccount>,
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
      anonConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      tables: ["demo_workspaces", "user_demo_workspaces"],
    });
    return await listDemoWorkspacesFromSupabase();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("❌ [SUPABASE-WORKSPACE-EXCEPTION] isolated catch:", {
      message: err.message,
      stack: err.stack,
      cause: err.cause,
    });
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

export async function GET(request: NextRequest) {
  console.log(
    "🚨 [CRITICAL DEBUG] -> API ROUTE HIT! The request successfully reached the route handler.",
  );

  if (!isAuthorized(request)) {
    console.warn("[paper-scalp] Unauthorized — bearer token mismatch or missing");
    writeServerLogAsync({
      level: "warn",
      source: "paper-scalp-route",
      message: "unauthorized_cron_request",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = performance.now();
  const timestamp = new Date().toISOString();

  try {
    const listResult = await fetchDemoWorkspacesSafe();
    if (!listResult.ok) {
      console.error("[paper-scalp] workspace list failed:", listResult.error);
      writeServerLogAsync({
        level: "error",
        source: "paper-scalp-route",
        message: "workspace_list_failed",
        meta: { detail: listResult.error },
      });
      return NextResponse.json(
        {
          error: listResult.error ?? "Unable to load demo workspaces",
          phase: "supabase_workspaces",
        },
        { status: 503 },
      );
    }

    console.log(
      `[paper-scalp] Supabase OK — loaded ${listResult.data.length} workspace(s)`,
    );

    const openSymbols = listResult.data.flatMap((ws) => {
      const snap = ws.snapshot;
      const active = snap.profiles.find((p) => p.id === snap.activeId);
      const account = active?.payload ? hydrateAccount(active.payload) : null;
      return (account?.openPositions ?? []).map((t) => t.symbol);
    });

    const symbols = resolvePaperScalpSymbols(openSymbols);
    const marketCoins = resolveMarketCoins();

    let snapshotSource: "binance" | "mock" = "mock";
    let scalpSnapshots: Map<string, Scalp1mSnapshot>;

    try {
      const loaded = await loadPaperScalpSnapshotsResilient(symbols, marketCoins);
      scalpSnapshots = loaded.snapshots;
      snapshotSource = loaded.source;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("[BINANCE-FETCH-BLOCKED] route-level kline catch:", {
        message: err.message,
        stack: err.stack,
        cause: err.cause,
      });
      writeServerLogFromError("paper-scalp-route", err, {
        phase: "binance_klines",
        symbols,
      });
      scalpSnapshots = buildMockScalpSnapshots(symbols, marketCoins);
      snapshotSource = "mock";
    }

    console.log(
      `[${timestamp}] [paper-scalp] market=mockCoins snapshots=${scalpSnapshots.size} source=${snapshotSource} symbols=[${symbols.join(", ")}]`,
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
      if (!activeProfile) {
        console.log(`[paper-scalp] workspace=${workspaceKey} | skipped (no active profile)`);
        continue;
      }

      const hydrated = hydrateAccount(activeProfile.payload);
      if (!hydrated) {
        console.log(`[paper-scalp] workspace=${workspaceKey} | skipped (hydrate failed)`);
        continue;
      }

      const alignedWallet = alignPaperScalpWallet(hydrated);
      const walletReset = paperWalletWasAligned(hydrated, alignedWallet);
      if (walletReset) {
        console.log(
          `[paper-scalp] workspace=${workspaceKey} | wallet realigned to $${resolvePaperScalpWalletUsd()} (was $${hydrated.currentBalance.toFixed(2)})`,
        );
      }

      console.log(`[paper-scalp] workspace=${workspaceKey} | scanning…`);
      logWorkspaceIndicators(workspaceKey, symbols, scalpSnapshots);

      const account = normalizeAccount(alignedWallet);
      const result = runPaperTradingAutomationTick({
        account,
        marketCoins,
        scalpSnapshots,
        autoPilotMode: snapshot.autoPilotMode,
        copyProfile: snapshot.copyProfile,
      });

      const action = resolveTradingAction(result.summary);
      console.log(
        `[paper-scalp] workspace=${workspaceKey} | action=${action} | summary=${result.summary} | changed=${result.changed} | balance=${result.account.currentBalance.toFixed(2)}`,
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
            console.error(
              `[paper-scalp] workspace=${workspaceKey} | save failed`,
              saveResult.error,
            );
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

    const duration = (performance.now() - startTime).toFixed(2);
    console.log(
      `[${timestamp}] ✅ Loop completed in ${duration}ms | scanned=${scanned} updated=${updated}`,
    );

    return NextResponse.json({
      ok: true,
      scanned,
      updated,
      actions,
      symbols,
      snapshotsLoaded: scalpSnapshots.size,
      snapshotSource,
      marketSource: "mockCoins",
      ranAt: new Date().toISOString(),
      durationMs: Number(duration),
    });
  } catch (error: unknown) {
    logFatalRouteException(error, "fatal_route_exception");
    const duration = (performance.now() - startTime).toFixed(2);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: "Internal execution failure",
        details: message,
        phase: "fatal_route_exception",
        durationMs: Number(duration),
      },
      { status: 500 },
    );
  }
}
