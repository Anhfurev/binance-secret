import type { AITradeSignal, CoinData, DemoAccount } from "@/lib/types";
import { runPaperScalp1hTick } from "@/lib/trading/paper-scalp-engine";
import type { Scalp1mSnapshot } from "@/lib/trading/paper-scalp-indicators";
import type { PaperScalpWorkspaceSettings } from "@/lib/trading/paper-scalp-settings";
import type { PaperAutomationTickResult } from "@/lib/trading/paper-scalp-types";
type AutoPilotMode = "signals" | "dca";
export type { PaperAutomationTickResult };

/** Institutional 1h EMA/RSI/ATR paper tick. */
export function runPaperTradingAutomationTick(params: {
  account: DemoAccount;
  signals?: AITradeSignal[];
  marketCoins?: CoinData[];
  scalpSnapshots?: Map<string, Scalp1mSnapshot>;
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

  return runPaperScalp1hTick({
    account: params.account,
    snapshots,
    marketCoins,
    paperSettings: params.paperSettings,
  });
}
