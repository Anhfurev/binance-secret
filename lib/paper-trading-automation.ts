import type { AITradeSignal, CoinData, DemoAccount } from "@/lib/types";
import {
  isMicroEngineMode,
  resolvePaperEngineMode,
} from "@/lib/trading/paper-scalp-engine-mode";
import { runPaperScalp15mTick } from "@/lib/trading/paper-scalp-engine";
import type {
  Scalp1mSnapshot,
  ScalpCandle,
} from "@/lib/trading/paper-scalp-indicators";
import type { DemoWorkspaceOwnerType } from "@/lib/supabase-demo";
import type { PaperWorkspaceDbCtx } from "@/lib/trading/paper-portfolio-db";
import type { DualMicroHarvest } from "@/lib/trading/paper-scalp-micro-klines";
import type { PaperScalpWorkspaceSettings } from "@/lib/trading/paper-scalp-settings";
import type { PaperAutomationTickResult } from "@/lib/trading/paper-scalp-types";

type AutoPilotMode = "signals" | "dca";
type CopyProfile = "conservative" | "balanced" | "aggressive";

export type { PaperAutomationTickResult };

/** Paper tick — alpha 15m or micro 1m/3m per PAPER_ENGINE_MODE. */
export async function runPaperTradingAutomationTick(params: {
  account: DemoAccount;
  signals?: AITradeSignal[];
  marketCoins?: CoinData[];
  scalpSnapshots?: Map<string, Scalp1mSnapshot>;
  candlesBySymbol?: Map<string, ScalpCandle[]>;
  candles1m?: Map<string, ScalpCandle[]>;
  candles3m?: Map<string, ScalpCandle[]>;
  microHarvest?: DualMicroHarvest;
  apiDegraded?: boolean;
  autoPilotMode: AutoPilotMode;
  copyProfile: CopyProfile;
  paperSettings: PaperScalpWorkspaceSettings;
  workspaceKey?: string | null;
  ownerType?: DemoWorkspaceOwnerType;
  ownerId?: string;
  userId?: string;
  dbCtx?: PaperWorkspaceDbCtx | null;
}): Promise<PaperAutomationTickResult> {
  const marketCoins = params.marketCoins ?? [];
  const snapshots = params.scalpSnapshots ?? new Map<string, Scalp1mSnapshot>();

  if (snapshots.size === 0 && !isMicroEngineMode()) {
    return {
      account: params.account,
      changed: false,
      summary: "no-hourly-snapshots",
    };
  }

  return await runPaperScalp15mTick({
    account: params.account,
    snapshots,
    candlesBySymbol: params.candlesBySymbol ?? new Map(),
    marketCoins,
    paperSettings: params.paperSettings,
    apiDegraded: params.apiDegraded,
    workspaceKey: params.workspaceKey,
    ownerType: params.ownerType,
    ownerId: params.ownerId,
    userId: params.userId,
    dbCtx: params.dbCtx,
    candles1m: params.candles1m,
    candles3m: params.candles3m,
  });
}

export { resolvePaperEngineMode };
