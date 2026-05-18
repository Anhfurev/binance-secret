import type { AITradeSignal, CoinData, DemoAccount } from "@/lib/types";
import {
  runPaperScalp1mTick,
  type PaperAutomationTickResult,
} from "@/lib/trading/paper-scalp-engine";
import type { Scalp1mSnapshot } from "@/lib/trading/paper-scalp-indicators";
import { notifyPaperScalpDecision } from "@/lib/trading/paper-scalp-telegram";

type AutoPilotMode = "signals" | "dca";
type CopyProfile = "conservative" | "balanced" | "aggressive";

export type { PaperAutomationTickResult };

/** Institutional 1m EMA/ATR scalp tick (replaces legacy signal-only path). */
export function runPaperTradingAutomationTick(params: {
  account: DemoAccount;
  signals?: AITradeSignal[];
  marketCoins?: CoinData[];
  scalpSnapshots?: Map<string, Scalp1mSnapshot>;
  autoPilotMode: AutoPilotMode;
  copyProfile: CopyProfile;
}): PaperAutomationTickResult {
  const marketCoins = params.marketCoins ?? [];
  const snapshots = params.scalpSnapshots ?? new Map<string, Scalp1mSnapshot>();

  if (snapshots.size === 0) {
    notifyPaperScalpDecision({
      kind: "skip",
      reason: "no-1m-snapshots",
      details: {
        balance: params.account.currentBalance,
        hint: "klines fetch failed or symbols empty",
      },
      throttleKey: "no-1m-snapshots",
    });
    return {
      account: params.account,
      changed: false,
      summary: "no-1m-snapshots",
    };
  }

  return runPaperScalp1mTick({
    account: params.account,
    snapshots,
    marketCoins,
    copyProfile: params.copyProfile,
  });
}
