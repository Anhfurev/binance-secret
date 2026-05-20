import { resolvePaperLiveMarkPrice } from "@/lib/trading/paper-scalp-mark-price";
import { closePaperScalpTrade } from "@/lib/trading/paper-scalp-positions";
import {
  computeMicroTrailState,
  microTrailExitHit,
} from "@/lib/trading/micro-scalp-trailing";
import type { Scalp1mSnapshot } from "@/lib/trading/paper-scalp-indicators";
import type { PaperAutomationTickResult } from "@/lib/trading/paper-scalp-types";
import type { CoinData, DemoAccount, DemoTrade } from "@/lib/types";

function norm(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

function patchLeg(
  account: DemoAccount,
  id: string,
  trade: DemoTrade,
): DemoAccount {
  return {
    ...account,
    openPositions: account.openPositions.map((p) => (p.id === id ? trade : p)),
  };
}

export type MicroOpenEval = {
  account: DemoAccount;
  exit: PaperAutomationTickResult | null;
  stopAdjusted: boolean;
};

/** In-memory leg eval — production micro path uses `runMicroTrailingPass` + `paper_positions`. */
export function evaluateMicroOpenPosition(params: {
  account: DemoAccount;
  trade: DemoTrade;
  snapshots: Map<string, Scalp1mSnapshot>;
  marketCoins: CoinData[];
}): MicroOpenEval {
  const sym = norm(params.trade.symbol);
  const snap = params.snapshots.get(sym);
  const mark = resolvePaperLiveMarkPrice(
    sym,
    params.marketCoins,
    snap?.close ?? params.trade.entryPrice,
  );

  const trail = computeMicroTrailState(
    params.trade.entryPrice,
    mark,
    params.trade.highestPriceReached ?? params.trade.entryPrice,
    params.trade.stopLoss,
    (params.trade.highestPriceReached ?? 0) > params.trade.entryPrice,
  );

  const patched: DemoTrade = {
    ...params.trade,
    highestPriceReached: trail.peak,
    stopLoss: trail.stopLoss,
  };

  const stopAdjusted =
    patched.stopLoss !== params.trade.stopLoss ||
    patched.highestPriceReached !== params.trade.highestPriceReached;

  let account = stopAdjusted
    ? patchLeg(params.account, params.trade.id, patched)
    : params.account;

  if (microTrailExitHit(mark, trail.stopLoss)) {
    const reason = trail.armed ? "micro-trail-0.5pct" : "micro-stop";
    return {
      account,
      exit: closePaperScalpTrade(account, patched, mark, reason, {
        signalExitPrice: mark,
      }),
      stopAdjusted,
    };
  }

  return { account, exit: null, stopAdjusted };
}
