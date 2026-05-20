import { closePaperScalpTrade } from "@/lib/trading/paper-scalp-positions";
import { applyLiveProfileNav } from "@/lib/trading/paper-profile-live";
import { syncPaperTradeImmediately } from "@/lib/trading/paper-trades-sync";
import { resolvePaperLiveMarkPrice } from "@/lib/trading/paper-scalp-mark-price";
import {
  computeTradeCloseEconomics,
} from "@/lib/trading/paper-trade-economics";
import {
  closePaperPositionRow,
  demoTradeFromPositionRow,
  isPaperPositionTrailArmed,
  matchOpenLegToPositionRow,
  updatePaperPositionTrail,
  type PaperPositionRow,
} from "@/lib/trading/paper-positions-db";
import type { DemoWorkspaceOwnerType } from "@/lib/supabase-demo";
import type { PaperWorkspaceDbCtx } from "@/lib/trading/paper-portfolio-db";
import type { Scalp1mSnapshot, ScalpCandle } from "@/lib/trading/paper-scalp-indicators";
import type { PaperAutomationTickResult } from "@/lib/trading/paper-scalp-types";
import type { CoinData, DemoAccount, DemoTrade } from "@/lib/types";

export function readMicroTrailArmPct(): number {
  const n = Number(String(process.env.MICRO_TRAIL_ARM_PCT ?? "1.5").trim());
  return Number.isFinite(n) && n > 0 ? n : 1.5;
}

export function readMicroTrailGapPct(): number {
  const n = Number(String(process.env.MICRO_TRAIL_GAP_PCT ?? "0.5").trim());
  return Number.isFinite(n) && n > 0 ? n : 0.5;
}

export type MicroTrailState = {
  peak: number;
  stopLoss: number;
  armed: boolean;
  profitPct: number;
};

export function computeMicroTrailState(
  entry: number,
  mark: number,
  priorPeak: number,
  priorStop: number,
  priorArmed: boolean,
): MicroTrailState {
  const peak = Number(Math.max(priorPeak, mark).toFixed(8));
  const profitPct =
    entry > 0 ? Number((((mark - entry) / entry) * 100).toFixed(4)) : 0;
  const armed = priorArmed || profitPct >= readMicroTrailArmPct();
  const gap = readMicroTrailGapPct() / 100;
  let stopLoss = priorStop;
  if (armed) {
    stopLoss = Number(Math.max(stopLoss, peak * (1 - gap)).toFixed(8));
  } else {
    const arm = readMicroTrailArmPct() / 100;
    stopLoss = Number(Math.max(stopLoss, entry * (1 - arm)).toFixed(8));
  }
  return { peak, stopLoss, armed, profitPct };
}

function markFromLiveCandles(
  symbol: string,
  liveCandles: Map<string, ScalpCandle[]>,
  snapshots: Map<string, Scalp1mSnapshot>,
  marketCoins: CoinData[],
  fallback: number,
): number {
  const sym = symbol.toUpperCase();
  const c1 = liveCandles.get(sym);
  const last = c1?.[c1.length - 1]?.close;
  const snap = snapshots.get(sym);
  return resolvePaperLiveMarkPrice(sym, marketCoins, last ?? snap?.close ?? fallback);
}

function logMicroTrailClose(
  symbol: string,
  leg: DemoTrade,
  mark: number,
  gapPct: number,
): void {
  const economics = computeTradeCloseEconomics({
    entryPrice: leg.entryPrice,
    exitPrice: mark,
    amount: leg.amount,
    notionalUsdt: leg.value,
    isLong: leg.type === "buy",
    signalEntryPrice: leg.originalEntryPrice ?? leg.entryPrice,
    signalExitPrice: mark,
  });
  const fees = economics.entryFeeUsdt + economics.exitFeeUsdt;
  console.log(
    `[TRADE LOG] ${symbol} micro-trail-${gapPct}% | Raw: ${economics.rawPnlUsdt.toFixed(4)} | Fees: ${fees.toFixed(4)} | Net: ${economics.netPnlUsdt.toFixed(4)}`,
  );
}

export type MicroTrailingContext = {
  account: DemoAccount;
  workspaceKey: string;
  userId: string;
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
  marketCoins: CoinData[];
  snapshots: Map<string, Scalp1mSnapshot>;
  dbCtx?: PaperWorkspaceDbCtx | null;
};

export type MicroTrailingPassResult = {
  account: DemoAccount;
  exits: PaperAutomationTickResult[];
  stopAdjusted: boolean;
};

export async function runMicroTrailingPass(
  openPositions: PaperPositionRow[],
  liveCandles: Map<string, ScalpCandle[]>,
  context: MicroTrailingContext,
): Promise<MicroTrailingPassResult> {
  const gapPct = readMicroTrailGapPct();
  const exits: PaperAutomationTickResult[] = [];
  let account = context.account;
  let stopAdjusted = false;

  for (const row of openPositions) {
    const mark = markFromLiveCandles(
      row.symbol,
      liveCandles,
      context.snapshots,
      context.marketCoins,
      row.entry_price,
    );

    const priorArmed = isPaperPositionTrailArmed(row);
    const trail = computeMicroTrailState(
      row.entry_price,
      mark,
      row.peak_price,
      row.trail_price,
      priorArmed,
    );

    if (
      trail.peak !== row.peak_price ||
      trail.stopLoss !== row.trail_price ||
      trail.armed !== priorArmed
    ) {
      stopAdjusted = true;
      await updatePaperPositionTrail({
        id: row.id,
        peak_price: trail.peak,
        trail_price: trail.stopLoss,
      });
    }

    if (mark > trail.stopLoss) continue;

    const leg =
      matchOpenLegToPositionRow(account.openPositions, row) ??
      demoTradeFromPositionRow(row);

    logMicroTrailClose(row.symbol, leg, mark, gapPct);

    const exit = closePaperScalpTrade(account, leg, mark, `micro-trail-${gapPct}pct`, {
      signalExitPrice: mark,
    });
    account = exit.account;
    exits.push(exit);
    await closePaperPositionRow(row.id);

    const closedLeg = account.tradeHistory[0];
    if (closedLeg) {
      await syncPaperTradeImmediately({
        ownerType: context.ownerType,
        ownerId: context.ownerId,
        workspaceKey: context.workspaceKey,
        trade: closedLeg,
      });
    }

    await applyLiveProfileNav({
      userId: context.userId,
      account,
      marketCoins: context.marketCoins,
      dbCtx: context.dbCtx,
    });
  }

  return { account, exits, stopAdjusted };
}
