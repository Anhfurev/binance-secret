import { NextRequest, NextResponse } from "next/server";
import type { CoinData } from "@/lib/types";
import { mockCoins } from "@/lib/mock-data";
export const dynamic = "force-dynamic";
import {
  hydrateAccount,
  normalizeAccount,
  serializeAccount,
} from "@/lib/demo-account";
import {
  listDemoWorkspacesFromSupabase,
  saveDemoWorkspaceForOwner,
} from "@/lib/supabase-demo";
import { runPaperTradingAutomationTick } from "@/lib/paper-trading-automation";
import {
  loadPaperScalpSnapshots,
  resolvePaperScalpSymbols,
} from "@/lib/trading/paper-scalp-klines";

type MarketApiResponse = {
  coins?: CoinData[];
};

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function loadMarket(origin: string): Promise<CoinData[]> {
  try {
    const response = await fetch(`${origin}/api/market`, {
      cache: "no-store",
      signal: AbortSignal.timeout(120),
    });
    if (!response.ok) throw new Error("market fetch failed");
    const data = (await response.json()) as MarketApiResponse;
    return data.coins?.length ? data.coins : mockCoins;
  } catch {
    return mockCoins;
  }
}

export async function GET(request: NextRequest) {
  console.log(
    "🚨 [CRITICAL DEBUG] -> API ROUTE HIT! The request successfully reached the route handler.",
  );

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = performance.now();
  const timestamp = new Date().toISOString();

  try {
    const listResult = await listDemoWorkspacesFromSupabase();
    if (!listResult.ok) {
      return NextResponse.json(
        {
          error: listResult.error ?? "Unable to load demo workspaces",
        },
        { status: 503 },
      );
    }

    const origin = new URL(request.url).origin;
    const openSymbols = listResult.data.flatMap((ws) => {
      const snap = ws.snapshot;
      const active = snap.profiles.find((p) => p.id === snap.activeId);
      const account = active?.payload ? hydrateAccount(active.payload) : null;
      return (account?.openPositions ?? []).map((t) => t.symbol);
    });

    const symbols = resolvePaperScalpSymbols(openSymbols);
    const [marketCoins, scalpSnapshots] = await Promise.all([
      loadMarket(origin),
      loadPaperScalpSnapshots(symbols),
    ]);

    console.log(
      `[${timestamp}] [paper-scalp] Loaded ${scalpSnapshots.size} 1m indicator snapshots for [${symbols.join(", ")}]`,
    );

    let scanned = 0;
    let updated = 0;
    const actions: string[] = [];
    const pendingSaves: Promise<void>[] = [];

    for (const workspace of listResult.data) {
      scanned += 1;
      const snapshot = workspace.snapshot;

      if (!snapshot.demoAutoPilot || snapshot.walletMode === "real") {
        continue;
      }

      const activeProfile = snapshot.profiles.find(
        (profile) => profile.id === snapshot.activeId,
      );
      if (!activeProfile) continue;

      const hydrated = hydrateAccount(activeProfile.payload);
      if (!hydrated) continue;

      const result = runPaperTradingAutomationTick({
        account: normalizeAccount(hydrated),
        marketCoins,
        scalpSnapshots,
        autoPilotMode: snapshot.autoPilotMode,
        copyProfile: snapshot.copyProfile,
      });

      if (!result.changed) continue;

      const nextProfiles = snapshot.profiles.map((profile) =>
        profile.id === snapshot.activeId
          ? { ...profile, payload: serializeAccount(result.account) }
          : profile,
      );

      pendingSaves.push(
        saveDemoWorkspaceForOwner(workspace.ownerType, workspace.ownerId, {
          ...snapshot,
          profiles: nextProfiles,
        }).then((saveResult) => {
          if (!saveResult.ok) {
            actions.push(
              `save-failed:${workspace.ownerType}:${workspace.ownerId}`,
            );
            return;
          }
          updated += 1;
          actions.push(
            `${workspace.ownerType}:${workspace.ownerId}:${result.summary}`,
          );
        }),
      );
    }

    await Promise.all(pendingSaves);

    const duration = (performance.now() - startTime).toFixed(2);
    console.log(
      `[${timestamp}] ✅ Loop completed successfully in ${duration}ms | scanned=${scanned} updated=${updated}\n`,
    );

    return NextResponse.json({
      ok: true,
      scanned,
      updated,
      actions,
      symbols,
      snapshotsLoaded: scalpSnapshots.size,
      ranAt: new Date().toISOString(),
      durationMs: Number(duration),
    });
  } catch (error: any) {
    const duration = (performance.now() - startTime).toFixed(2);
    console.error(
      `[${timestamp}] ❌ CRITICAL LOOP ERROR after ${duration}ms:`,
      error.message || error,
    );
    return NextResponse.json(
      { error: "Internal execution failure", details: error.message },
      { status: 500 },
    );
  }
}
