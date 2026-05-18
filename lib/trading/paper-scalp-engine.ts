import type { Scalp1mSnapshot, ScalpCandle } from "@/lib/trading/paper-scalp-indicators";
import { runPaperScalpAlphaTick } from "@/lib/trading/paper-scalp-alpha-tick";
import type { PaperScalpWorkspaceSettings } from "@/lib/trading/paper-scalp-settings";
import type { PaperAutomationTickResult } from "@/lib/trading/paper-scalp-types";
import type { CoinData, DemoAccount } from "@/lib/types";

export type { PaperAutomationTickResult };

export { calculateDynamicRegime } from "@/lib/trading/paper-scalp-regime";
export { rankAltcoinMomentum } from "@/lib/trading/paper-scalp-momentum-rank";

/** 15m alpha execution loop (regime + momentum rotation). */
export function runPaperScalp15mTick(params: {
  account: DemoAccount;
  snapshots: Map<string, Scalp1mSnapshot>;
  candlesBySymbol: Map<string, ScalpCandle[]>;
  marketCoins: CoinData[];
  paperSettings: PaperScalpWorkspaceSettings;
  apiDegraded?: boolean;
}): PaperAutomationTickResult {
  return runPaperScalpAlphaTick(params);
}

/** @deprecated Alias — paper scalp now runs on 15m alpha engine. */
export function runPaperScalp1hTick(params: {
  account: DemoAccount;
  snapshots: Map<string, Scalp1mSnapshot>;
  marketCoins: CoinData[];
  paperSettings: PaperScalpWorkspaceSettings;
  candlesBySymbol?: Map<string, ScalpCandle[]>;
  apiDegraded?: boolean;
}): PaperAutomationTickResult {
  return runPaperScalpAlphaTick({
    ...params,
    candlesBySymbol: params.candlesBySymbol ?? new Map(),
  });
}

export const runPaperScalp1mTick = runPaperScalp15mTick;
