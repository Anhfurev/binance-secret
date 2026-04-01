import { NextRequest, NextResponse } from "next/server";
import type { AITradeSignal, CoinData } from "@/lib/types";
import { mockSignals } from "@/lib/signals-data";
import { mockCoins } from "@/lib/mock-data";
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

type SignalsApiResponse = {
  signals?: AITradeSignal[];
};

type MarketApiResponse = {
  coins?: CoinData[];
};

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function loadSignals(origin: string) {
  try {
    const response = await fetch(`${origin}/api/signals`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("signal fetch failed");
    const data = (await response.json()) as SignalsApiResponse;
    return data.signals?.length ? data.signals : mockSignals;
  } catch {
    return mockSignals;
  }
}

async function loadMarket(origin: string) {
  try {
    const response = await fetch(`${origin}/api/market`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("market fetch failed");
    const data = (await response.json()) as MarketApiResponse;
    return data.coins?.length ? data.coins : mockCoins;
  } catch {
    return mockCoins;
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const [signals, marketCoins] = await Promise.all([
    loadSignals(origin),
    loadMarket(origin),
  ]);

  let scanned = 0;
  let updated = 0;
  const actions: string[] = [];

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
      signals,
      marketCoins,
      autoPilotMode: snapshot.autoPilotMode,
      copyProfile: snapshot.copyProfile,
    });

    if (!result.changed) continue;

    const nextProfiles = snapshot.profiles.map((profile) =>
      profile.id === snapshot.activeId
        ? { ...profile, payload: serializeAccount(result.account) }
        : profile,
    );

    const saveResult = await saveDemoWorkspaceForOwner(
      workspace.ownerType,
      workspace.ownerId,
      {
        ...snapshot,
        profiles: nextProfiles,
      },
    );

    if (!saveResult.ok) {
      actions.push(`save-failed:${workspace.ownerType}:${workspace.ownerId}`);
      continue;
    }

    updated += 1;
    actions.push(
      `${workspace.ownerType}:${workspace.ownerId}:${result.summary}`,
    );
  }

  return NextResponse.json({
    ok: true,
    scanned,
    updated,
    actions,
    ranAt: new Date().toISOString(),
  });
}
