import type { AITradeSignal, CoinData, DemoAccount } from "@/lib/types";
import { runPaperScalp15mTick } from "@/lib/trading/paper-scalp-engine";
import type {
  Scalp1mSnapshot,
  ScalpCandle,
} from "@/lib/trading/paper-scalp-indicators";
import type { PaperScalpWorkspaceSettings } from "@/lib/trading/paper-scalp-settings";
import type { PaperAutomationTickResult } from "@/lib/trading/paper-scalp-types";

type AutoPilotMode = "signals" | "dca";
type CopyProfile = "conservative" | "balanced" | "aggressive";

export type { PaperAutomationTickResult };

/** 15m alpha paper tick — VWAP regime + momentum rotation. */
export function runPaperTradingAutomationTick(params: {
  account: DemoAccount;
  signals?: AITradeSignal[];
  marketCoins?: CoinData[];
  scalpSnapshots?: Map<string, Scalp1mSnapshot>;
  candlesBySymbol?: Map<string, ScalpCandle[]>;
  apiDegraded?: boolean;
  autoPilotMode: AutoPilotMode;
  copyProfile: CopyProfile;
  paperSettings: PaperScalpWorkspaceSettings;
}): PaperAutomationTickResult {
  const marketCoins = params.marketCoins ?? [];
  const snapshots = params.scalpSnapshots ?? new Map<string, Scalp1mSnapshot>();

  if (snapshots.size === 0) {
    return {
      account: params.account,
      changed: false,
      summary: "no-hourly-snapshots",
    };
  }

  return runPaperScalp15mTick({
    account: params.account,
    snapshots,
    candlesBySymbol: params.candlesBySymbol ?? new Map(),
    marketCoins,
    paperSettings: params.paperSettings,
    apiDegraded: params.apiDegraded,
  });
}
