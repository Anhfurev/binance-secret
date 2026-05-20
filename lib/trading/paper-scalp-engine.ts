import { maybeResetPaperDailyPnl } from "@/lib/trading/paper-scalp-daily";
import { runPaperScalpAlphaTick } from "@/lib/trading/paper-scalp-alpha-tick";
import { isMicroEngineMode } from "@/lib/trading/paper-scalp-engine-mode";
import { buildMicroEntryTrade } from "@/lib/trading/micro-scalp-entry";
import { pickBestMicroAcceleration } from "@/lib/trading/micro-scalp-acceleration";
import {
  applyDrawdownPauseAccount,
  evaluate24hDrawdownPause,
} from "@/lib/trading/micro-scalp-drawdown";
import { runMicroTrailingPass } from "@/lib/trading/micro-scalp-trailing";
import {
  harvestMicroCandlesParallel,
  type DualMicroHarvest,
} from "@/lib/trading/paper-scalp-micro-klines";
import { applyLiveProfileNav } from "@/lib/trading/paper-profile-live";
import { computePaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import type { PaperWorkspaceDbCtx } from "@/lib/trading/paper-portfolio-db";
import {
  loadOpenPaperPositions,
  syncOpenPositionsToDb,
  upsertOpenPaperPosition,
} from "@/lib/trading/paper-positions-db";
import {
  computePaperPositionSizeUsdt,
  type PaperScalpWorkspaceSettings,
} from "@/lib/trading/paper-scalp-settings";
import type { DemoWorkspaceOwnerType } from "@/lib/supabase-demo";
import { resolvePaperTradesUserId } from "@/lib/trading/paper-trades-sync";
import type { Scalp1mSnapshot, ScalpCandle } from "@/lib/trading/paper-scalp-indicators";
import type { PaperAutomationTickResult } from "@/lib/trading/paper-scalp-types";
import type { CoinData, DemoAccount } from "@/lib/types";

export type { PaperAutomationTickResult };
export { harvestMicroCandlesParallel } from "@/lib/trading/paper-scalp-micro-klines";
export { pickBestMicroAcceleration } from "@/lib/trading/micro-scalp-acceleration";
export { runMicroTrailingPass } from "@/lib/trading/micro-scalp-trailing";
export {
  evaluate24hDrawdownPause,
  checkMicroDrawdownCircuit,
} from "@/lib/trading/micro-scalp-drawdown";
export { placeMicroIocLimit } from "@/lib/trading/live-micro-order";

export type MicroEngineContext = {
  account: DemoAccount;
  workspaceKey: string;
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
  userId: string;
  marketCoins: CoinData[];
  paperSettings: PaperScalpWorkspaceSettings;
  dbCtx?: PaperWorkspaceDbCtx | null;
  harvest?: DualMicroHarvest;
  snapshots?: Map<string, Scalp1mSnapshot>;
  candles1m: Map<string, ScalpCandle[]>;
  candles3m: Map<string, ScalpCandle[]>;
};

function norm(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

function readMicroMaxOpen(fallback: number): number {
  const n = Number(String(process.env.MICRO_MAX_OPEN ?? "").trim());
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(8, Math.floor(n));
}

function resolveHarvest(context: MicroEngineContext): {
  snapshots: Map<string, Scalp1mSnapshot>;
  candles1m: Map<string, ScalpCandle[]>;
  candles3m: Map<string, ScalpCandle[]>;
} {
  if (context.harvest) {
    return {
      snapshots: context.harvest.snapshots,
      candles1m: context.harvest.candles1m,
      candles3m: context.harvest.candles3m,
    };
  }
  return {
    snapshots: context.snapshots ?? new Map(),
    candles1m: context.candles1m,
    candles3m: context.candles3m,
  };
}

/**
 * Micro tick pipeline (sequential):
 * drawdown → trailing closes → acceleration entries → live profile NAV.
 */
export async function runMicroScalpEngineTick(
  watchlist: string[],
  context: MicroEngineContext,
): Promise<PaperAutomationTickResult> {
  let account = maybeResetPaperDailyPnl(context.account);
  const { snapshots, candles1m, candles3m } = resolveHarvest(context);

  let nav = computePaperWorkspaceNav(account, context.marketCoins);

  const drawdown = await evaluate24hDrawdownPause({
    userId: context.userId,
    currentNavUsdt: nav.portfolio_nav_usdt,
  });
  account = applyDrawdownPauseAccount(account, drawdown);

  await syncOpenPositionsToDb({
    ownerType: context.ownerType,
    ownerId: context.ownerId,
    openTrades: account.openPositions,
  });

  const openPositions = await loadOpenPaperPositions(context.userId);
  const trailPass = await runMicroTrailingPass(openPositions, candles1m, {
    account,
    workspaceKey: context.workspaceKey,
    userId: context.userId,
    ownerType: context.ownerType,
    ownerId: context.ownerId,
    marketCoins: context.marketCoins,
    snapshots,
    dbCtx: context.dbCtx,
  });
  account = trailPass.account;
  nav = computePaperWorkspaceNav(account, context.marketCoins);

  const lastClose = trailPass.exits[trailPass.exits.length - 1]?.summary;
  const positionClosed = trailPass.exits.length > 0;
  const openCount = account.openPositions.length;

  if (account.circuitBreakerTripped) {
    await applyLiveProfileNav({
      userId: context.userId,
      account,
      marketCoins: context.marketCoins,
      dbCtx: context.dbCtx,
    });
    return {
      account,
      changed: trailPass.stopAdjusted || drawdown.paused || positionClosed,
      summary: drawdown.paused
        ? "drawdown-pause-24h"
        : openCount > 0
          ? "holding-position"
          : "circuit-breaker",
      positionClosed: positionClosed || undefined,
    };
  }

  if (openCount >= readMicroMaxOpen(context.paperSettings.maxOpenPositions)) {
    await applyLiveProfileNav({
      userId: context.userId,
      account,
      marketCoins: context.marketCoins,
      dbCtx: context.dbCtx,
    });
    return {
      account,
      changed: trailPass.stopAdjusted || positionClosed,
      summary: lastClose ?? "max-open-positions-reached",
      positionClosed: positionClosed || undefined,
    };
  }

  const held = new Set<string>();
  for (const p of account.openPositions) held.add(norm(p.symbol));
  for (const row of openPositions) held.add(norm(row.symbol));

  const hit = pickBestMicroAcceleration(watchlist, candles1m, candles3m, held);

  if (!hit) {
    await applyLiveProfileNav({
      userId: context.userId,
      account,
      marketCoins: context.marketCoins,
      dbCtx: context.dbCtx,
    });
    return {
      account,
      changed: trailPass.stopAdjusted || positionClosed,
      summary:
        lastClose ?? (openCount > 0 ? "holding-position" : "no-acceleration"),
      positionClosed: positionClosed || undefined,
    };
  }

  const size = computePaperPositionSizeUsdt(
    nav.portfolio_nav_usdt,
    context.paperSettings.riskPerTradePercent,
  );
  if (size.sizeUsdt <= 0 || nav.available_usdt < size.sizeUsdt) {
    await applyLiveProfileNav({
      userId: context.userId,
      account,
      marketCoins: context.marketCoins,
      dbCtx: context.dbCtx,
    });
    return {
      account,
      changed: trailPass.stopAdjusted || positionClosed,
      summary: lastClose ?? "insufficient-balance",
      positionClosed: positionClosed || undefined,
    };
  }

  const trade = buildMicroEntryTrade({
    hit,
    marketCoins: context.marketCoins,
    positionSizeUsdt: size.sizeUsdt,
  });

  account = {
    ...account,
    currentBalance: Math.max(0, account.currentBalance - size.sizeUsdt),
    openPositions: [...account.openPositions, trade],
  };

  await upsertOpenPaperPosition({
    ownerType: context.ownerType,
    ownerId: context.ownerId,
    trade,
  });

  await applyLiveProfileNav({
    userId: context.userId,
    account,
    marketCoins: context.marketCoins,
    dbCtx: context.dbCtx,
  });

  console.log(
    `[MICRO-ACCEL] ${hit.symbol} vol×${hit.volumeSpike} roc=${hit.rocPct}% nav=$${nav.portfolio_nav_usdt}`,
  );

  return {
    account,
    changed: true,
    summary: `opened:${norm(hit.symbol)}:micro-acceleration`,
    entryExecuted: true,
    positionClosed: positionClosed || undefined,
  };
}

export type PaperScalpTickParams = {
  account: DemoAccount;
  snapshots: Map<string, Scalp1mSnapshot>;
  candlesBySymbol: Map<string, ScalpCandle[]>;
  candles1m?: Map<string, ScalpCandle[]>;
  candles3m?: Map<string, ScalpCandle[]>;
  harvest?: DualMicroHarvest;
  marketCoins: CoinData[];
  paperSettings: PaperScalpWorkspaceSettings;
  apiDegraded?: boolean;
  workspaceKey?: string | null;
  ownerType?: DemoWorkspaceOwnerType;
  ownerId?: string;
  userId?: string;
  dbCtx?: PaperWorkspaceDbCtx | null;
};

export async function runPaperScalp15mTick(
  params: PaperScalpTickParams,
): Promise<PaperAutomationTickResult> {
  if (!isMicroEngineMode()) {
    return runPaperScalpAlphaTick(params);
  }

  const workspaceKey = params.workspaceKey ?? "device:local";
  const ownerType = params.ownerType ?? "device";
  const ownerId = params.ownerId ?? "local";
  const userId =
    params.userId ??
    params.dbCtx?.userId ??
    resolvePaperTradesUserId(ownerType, ownerId) ??
    "";

  const watchlist = params.paperSettings.symbols.map(norm);

  let harvest = params.harvest;
  if (!harvest && params.snapshots.size === 0) {
    harvest = await harvestMicroCandlesParallel(watchlist);
  }

  const candles1m =
    harvest?.candles1m ?? params.candles1m ?? params.candlesBySymbol;
  const candles3m = harvest?.candles3m ?? params.candles3m ?? new Map();

  return runMicroScalpEngineTick(watchlist, {
    account: params.account,
    workspaceKey,
    ownerType,
    ownerId,
    userId,
    marketCoins: params.marketCoins,
    paperSettings: params.paperSettings,
    dbCtx: params.dbCtx,
    harvest,
    snapshots: harvest?.snapshots ?? params.snapshots,
    candles1m,
    candles3m,
  });
}

export const runPaperScalp1mTick = runPaperScalp15mTick;
