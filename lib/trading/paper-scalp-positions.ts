import { percentOf, recalculateAccountMetrics } from "@/lib/demo-account";
import { defaultScalpingSettings } from "@/lib/trading/settings";
import type { Scalp1mSnapshot } from "@/lib/trading/paper-scalp-indicators";
import type { PaperAutomationTickResult } from "@/lib/trading/paper-scalp-types";
import type { CoinData, DemoAccount, DemoTrade } from "@/lib/types";

const ASSET_PROTECTION_DROP_PCT = 0.015;
const ATR_STOP_MULT = 1.5;

function logScalp(message: string, payload?: Record<string, unknown>) {
  if (payload) console.log(`[paper-scalp] ${message}`, payload);
  else console.log(`[paper-scalp] ${message}`);
}

function normalizeSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

function livePrice(
  symbol: string,
  marketCoins: CoinData[],
  fallback: number,
): number {
  const base = normalizeSymbol(symbol).replace(/USDT$/, "").toLowerCase();
  const coin = marketCoins.find((c) => c.symbol.toLowerCase() === base);
  return coin?.current_price ?? fallback;
}

function trailingAtrStop(trade: DemoTrade, mark: number, atr14: number): number {
  const dist = atr14 * ATR_STOP_MULT;
  const raw = mark - dist;
  return Math.max(trade.stopLoss, Number(raw.toFixed(8)));
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
  const pnl = Number(rawPnl.toFixed(2));
  const effectiveValue = trade.value;
  const pnlPercent = Number(((pnl / effectiveValue) * 100).toFixed(2));
  const newDailyPnl = (account.dailyPnl ?? 0) + pnl;
  const hitCb =
    newDailyPnl < 0 &&
    percentOf(Math.abs(newDailyPnl), account.startingBalance) >=
      defaultScalpingSettings.maxDailyLossPct;

  logScalp(`EXIT ${trade.symbol} | reason=${reason}`, {
    entryPrice: trade.entryPrice,
    closePrice: Number(closePrice.toFixed(8)),
    pnl,
    pnlPercent,
  });

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
};

/** Evaluate one open leg; may exit, trail stop, or hold. */
export function evaluateOpenPaperPosition(params: {
  account: DemoAccount;
  trade: DemoTrade;
  snapshots: Map<string, Scalp1mSnapshot>;
  marketCoins: CoinData[];
}): OpenPositionEvalResult {
  const { account, trade, snapshots, marketCoins } = params;
  const sym = normalizeSymbol(trade.symbol);
  const snap = snapshots.get(sym);
  const mark = livePrice(sym, marketCoins, snap?.close ?? trade.entryPrice);
  const atr14 =
    snap?.atr14 ?? Math.abs(trade.entryPrice - trade.stopLoss) / ATR_STOP_MULT;

  if (trade.type === "buy") {
    const dropPct = (trade.entryPrice - mark) / trade.entryPrice;
    if (dropPct >= ASSET_PROTECTION_DROP_PCT) {
      return {
        account,
        exit: closePaperScalpTrade(account, trade, mark, "asset-protection-1.5pct"),
        stopAdjusted: false,
      };
    }
  }

  const dynamicStop = trailingAtrStop(trade, mark, atr14);
  const tradeWithStop = { ...trade, stopLoss: dynamicStop };
  const stopAdjusted = dynamicStop > trade.stopLoss;
  const nextAccount: DemoAccount = stopAdjusted
    ? {
        ...account,
        openPositions: account.openPositions.map((p) =>
          p.id === trade.id ? tradeWithStop : p,
        ),
      }
    : account;

  if (mark <= dynamicStop) {
    return {
      account: nextAccount,
      exit: closePaperScalpTrade(nextAccount, tradeWithStop, mark, "atr-trailing-stop"),
      stopAdjusted,
    };
  }
  if (mark >= trade.takeProfit) {
    return {
      account: nextAccount,
      exit: closePaperScalpTrade(nextAccount, tradeWithStop, mark, "atr-take-profit-3x"),
      stopAdjusted,
    };
  }
  if (snap?.bearishCross) {
    return {
      account: nextAccount,
      exit: closePaperScalpTrade(nextAccount, tradeWithStop, mark, "ema9-below-ema21"),
      stopAdjusted,
    };
  }

  return { account: nextAccount, exit: null, stopAdjusted };
}
