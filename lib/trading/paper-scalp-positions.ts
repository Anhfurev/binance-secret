import { percentOf, recalculateAccountMetrics } from "@/lib/demo-account";
import { formatAssetPrice } from "@/lib/trading/paper-scalp-metrics-format";
import { resolvePaperLiveMarkPrice } from "@/lib/trading/paper-scalp-mark-price";
import { defaultScalpingSettings } from "@/lib/trading/settings";
import type { Scalp1mSnapshot } from "@/lib/trading/paper-scalp-indicators";
import { isPaperShortLeg } from "@/lib/trading/paper-scalp-leg-side";
import {
  applyTrailingProfitState,
  resolveLegAtr14,
} from "@/lib/trading/paper-scalp-trailing-exit";
import {
  VELOCITY_PARTIAL_SELL_RATIO,
  VELOCITY_TP_GAIN_PCT,
} from "@/lib/trading/paper-scalp-velocity";
import type { PaperAutomationTickResult } from "@/lib/trading/paper-scalp-types";
import type { CoinData, DemoAccount, DemoTrade } from "@/lib/types";

const ASSET_PROTECTION_DROP_PCT = 0.015;

function normalizeSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

function patchOpenLeg(
  account: DemoAccount,
  tradeId: string,
  trade: DemoTrade,
): DemoAccount {
  return {
    ...account,
    openPositions: account.openPositions.map((p) =>
      p.id === tradeId ? trade : p,
    ),
  };
}

export function closePaperScalpTrade(
  account: DemoAccount,
  trade: DemoTrade,
  closePrice: number,
  reason: string,
): PaperAutomationTickResult {
  const isLong = trade.type === "buy";
  const rawPnl = isLong
    ? (closePrice - trade.entryPrice) * trade.amount
    : (trade.entryPrice - closePrice) * trade.amount;
  const pnl = Number(rawPnl.toFixed(4));
  const effectiveValue = trade.value;
  const pnlPercent = Number(((pnl / effectiveValue) * 100).toFixed(2));
  const newDailyPnl = (account.dailyPnl ?? 0) + pnl;
  const hitCb =
    newDailyPnl < 0 &&
    percentOf(Math.abs(newDailyPnl), account.startingBalance) >=
      defaultScalpingSettings.maxDailyLossPct;

  const closedTrade: DemoTrade = {
    ...trade,
    status: pnl >= 0 ? "closed" : "stopped",
    exitPrice: Number(closePrice.toFixed(closePrice >= 1 ? 4 : 8)),
    pnl,
    pnlPercent,
    closedAt: new Date(),
    notes: `${trade.notes ?? ""} | exit:${reason}`.trim(),
    tags: [...(trade.tags ?? []), "paper-scalp", reason],
  };

  const newEquity = account.currentBalance + effectiveValue + pnl;

  return {
    account: recalculateAccountMetrics({
      ...account,
      currentBalance: newEquity,
      dailyPnl: newDailyPnl,
      circuitBreakerTripped: hitCb,
      equityCurve: [
        ...(account.equityCurve ?? []),
        { time: new Date().toISOString(), equity: newEquity },
      ],
      openPositions: account.openPositions.filter((p) => p.id !== trade.id),
      tradeHistory: [closedTrade, ...account.tradeHistory],
    }),
    changed: true,
    summary: `closed:${trade.symbol}:${reason}`,
  };
}

export type OpenPositionEvalResult = {
  account: DemoAccount;
  exit: PaperAutomationTickResult | null;
  stopAdjusted: boolean;
  velocityPartial?: boolean;
};

function tryVelocityPartialTakeProfit(
  account: DemoAccount,
  trade: DemoTrade,
  mark: number,
): { account: DemoAccount; executed: boolean; symbol: string } {
  const symbol = normalizeSymbol(trade.symbol);
  if (trade.velocityTakeProfitSecured || trade.type !== "buy") {
    return { account, executed: false, symbol };
  }

  const entry = trade.entryPrice;
  if (entry <= 0 || mark < entry * (1 + VELOCITY_TP_GAIN_PCT)) {
    return { account, executed: false, symbol };
  }

  const sellQty = Number((trade.amount * VELOCITY_PARTIAL_SELL_RATIO).toFixed(6));
  const remainQty = Number((trade.amount - sellQty).toFixed(6));
  if (sellQty <= 0 || remainQty <= 0) {
    return { account, executed: false, symbol };
  }

  const proceeds = Number((sellQty * mark).toFixed(4));
  const costSold = Number((trade.value * VELOCITY_PARTIAL_SELL_RATIO).toFixed(4));
  const partialPnl = Number((proceeds - costSold).toFixed(4));
  const remainValue = Number((trade.value - costSold).toFixed(4));
  const breakevenStop = Number(entry.toFixed(8));

  const runner: DemoTrade = {
    ...trade,
    amount: remainQty,
    value: remainValue,
    velocityTakeProfitSecured: true,
    stopLoss: Math.max(trade.stopLoss, breakevenStop),
    highestPriceReached: Number(
      Math.max(trade.highestPriceReached ?? mark, mark).toFixed(8),
    ),
    notes: `${trade.notes ?? ""} | velocity-70-banked`.trim(),
    tags: [...(trade.tags ?? []), "velocity-tp-70"],
    executionNotes: [
      ...(trade.executionNotes ?? []),
      `velocity70@${formatAssetPrice(mark)} proceeds=$${proceeds}`,
    ],
  };

  const partialRecord: DemoTrade = {
    ...trade,
    id: `${trade.id}-v70-${Date.now()}`,
    amount: sellQty,
    value: costSold,
    status: "closed",
    exitPrice: mark,
    pnl: partialPnl,
    pnlPercent:
      costSold > 0 ? Number(((partialPnl / costSold) * 100).toFixed(2)) : 0,
    closedAt: new Date(),
    notes: `${trade.notes ?? ""} | velocity-partial-70`.trim(),
    followedSignal: false,
    tags: [...(trade.tags ?? []), "velocity-partial-70", "paper-scalp"],
  };

  const patched = patchOpenLeg(
    {
      ...account,
      currentBalance: Number((account.currentBalance + proceeds).toFixed(4)),
      dailyPnl: Number(((account.dailyPnl ?? 0) + partialPnl).toFixed(4)),
      tradeHistory: [partialRecord, ...account.tradeHistory],
    },
    trade.id,
    runner,
  );

  return {
    account: recalculateAccountMetrics(patched),
    executed: true,
    symbol,
  };
}

/**
 * ATR trailing profit engine — peak track, ratchet SL, no capped TP exit.
 */
export function evaluateOpenPaperPosition(params: {
  account: DemoAccount;
  trade: DemoTrade;
  snapshots: Map<string, Scalp1mSnapshot>;
  marketCoins: CoinData[];
}): OpenPositionEvalResult {
  const { account, trade, snapshots, marketCoins } = params;
  const sym = normalizeSymbol(trade.symbol);
  const snap = snapshots.get(sym);
  const mark = resolvePaperLiveMarkPrice(
    sym,
    marketCoins,
    snap?.close ?? trade.entryPrice,
  );
  const atr14 = resolveLegAtr14(snap, trade);

  if (isPaperShortLeg(trade)) {
    const risePct = (mark - trade.entryPrice) / trade.entryPrice;
    if (risePct >= ASSET_PROTECTION_DROP_PCT) {
      return {
        account,
        exit: closePaperScalpTrade(
          account,
          trade,
          mark,
          "asset-protection-1.5pct-short",
        ),
        stopAdjusted: false,
      };
    }
  } else {
    const dropPct = (trade.entryPrice - mark) / trade.entryPrice;
    if (dropPct >= ASSET_PROTECTION_DROP_PCT) {
      return {
        account,
        exit: closePaperScalpTrade(account, trade, mark, "asset-protection-1.5pct"),
        stopAdjusted: false,
      };
    }
  }

  const velocityHit = tryVelocityPartialTakeProfit(account, trade, mark);
  if (velocityHit.executed) {
    const runner =
      velocityHit.account.openPositions.find((p) => p.id === trade.id) ?? trade;
    const trailedTrade = applyTrailingProfitState(runner, mark, atr14).trade;
    const nextAccount = patchOpenLeg(velocityHit.account, trade.id, trailedTrade);
    return {
      account: nextAccount,
      exit: null,
      stopAdjusted: true,
      velocityPartial: true,
    };
  }

  const trail = applyTrailingProfitState(trade, mark, atr14);
  const trailed = trail.trade;
  const stopAdjusted = trail.stopRatcheted || trail.peakUpdated;
  let nextAccount = stopAdjusted ? patchOpenLeg(account, trade.id, trailed) : account;

  if (isPaperShortLeg(trailed)) {
    if (mark >= trailed.stopLoss) {
      return {
        account: nextAccount,
        exit: closePaperScalpTrade(
          nextAccount,
          trailed,
          mark,
          "atr-trailing-stop-short",
        ),
        stopAdjusted,
      };
    }
    if (snap?.bullishCross) {
      return {
        account: nextAccount,
        exit: closePaperScalpTrade(
          nextAccount,
          trailed,
          mark,
          "ema9-above-ema21-short-cover",
        ),
        stopAdjusted,
      };
    }
    return { account: nextAccount, exit: null, stopAdjusted };
  }

  if (mark <= trailed.stopLoss) {
    return {
      account: nextAccount,
      exit: closePaperScalpTrade(nextAccount, trailed, mark, "atr-trailing-stop"),
      stopAdjusted,
    };
  }

  if (snap?.bearishCross) {
    return {
      account: nextAccount,
      exit: closePaperScalpTrade(nextAccount, trailed, mark, "ema9-below-ema21"),
      stopAdjusted,
    };
  }

  return { account: nextAccount, exit: null, stopAdjusted };
}
