import { percentOf, recalculateAccountMetrics } from "@/lib/demo-account";
import { defaultScalpingSettings } from "@/lib/trading/settings";
import {
  computeAtrStops,
  type Scalp1mSnapshot,
} from "@/lib/trading/paper-scalp-indicators";
import type { CoinData, DemoAccount, DemoTrade } from "@/lib/types";
import {
  formatSnapshotScanLine,
  notifyPaperScalpBuy,
  notifyPaperScalpDecision,
  notifyPaperScalpExit,
} from "@/lib/trading/paper-scalp-telegram";

export interface PaperAutomationTickResult {
  account: DemoAccount;
  changed: boolean;
  summary: string;
}

const POSITION_FRACTION = 0.2;
const ASSET_PROTECTION_DROP_PCT = 0.015;
const ATR_STOP_MULT = 1.5;
const ATR_TP_MULT = 3;

type CopyProfile = "conservative" | "balanced" | "aggressive";

function maxOpenForProfile(profile: CopyProfile): number {
  if (profile === "conservative") return 3;
  if (profile === "aggressive") return 5;
  return 4;
}

function logScalp(message: string, payload?: Record<string, unknown>) {
  if (payload) {
    console.log(`[paper-scalp] ${message}`, payload);
  } else {
    console.log(`[paper-scalp] ${message}`);
  }
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

function fractionalNotional(balance: number): number {
  return Number((balance * POSITION_FRACTION).toFixed(2));
}

function closeTrade(
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

  notifyPaperScalpExit({
    symbol: trade.symbol,
    reason,
    exitPrice: closePrice,
    performancePct: pnlPercent,
    entryPrice: trade.entryPrice,
    pnlUsd: pnl,
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

function shouldForceAssetProtection(
  trade: DemoTrade,
  mark: number,
): boolean {
  if (trade.type !== "buy") return false;
  const dropPct = (trade.entryPrice - mark) / trade.entryPrice;
  return dropPct >= ASSET_PROTECTION_DROP_PCT;
}

function trailingAtrStop(trade: DemoTrade, mark: number, atr14: number): number {
  const dist = atr14 * ATR_STOP_MULT;
  const raw = mark - dist;
  return Math.max(trade.stopLoss, Number(raw.toFixed(8)));
}

export function runPaperScalp1mTick(params: {
  account: DemoAccount;
  snapshots: Map<string, Scalp1mSnapshot>;
  marketCoins: CoinData[];
  copyProfile: CopyProfile;
}): PaperAutomationTickResult {
  const { account, snapshots, marketCoins, copyProfile } = params;

  if (account.circuitBreakerTripped) {
    notifyPaperScalpDecision({
      kind: "skip",
      reason: "circuit-breaker",
      details: {
        dailyPnl: account.dailyPnl ?? 0,
        balance: account.currentBalance,
      },
      throttleKey: "circuit-breaker",
    });
    return { account, changed: false, summary: "circuit-breaker" };
  }

  const open = account.openPositions[0];
  if (open) {
    const sym = normalizeSymbol(open.symbol);
    const snap = snapshots.get(sym);
    const mark = livePrice(sym, marketCoins, snap?.close ?? open.entryPrice);
    const atr14 = snap?.atr14 ?? Math.abs(open.entryPrice - open.stopLoss) / ATR_STOP_MULT;

    if (shouldForceAssetProtection(open, mark)) {
      return closeTrade(account, open, mark, "asset-protection-1.5pct");
    }

    const dynamicStop = trailingAtrStop(open, mark, atr14);
    open.stopLoss = dynamicStop;

    if (mark <= dynamicStop) {
      return closeTrade(account, open, mark, "atr-trailing-stop");
    }
    if (mark >= open.takeProfit) {
      return closeTrade(account, open, mark, "atr-take-profit-3x");
    }
    if (snap?.bearishCross) {
      return closeTrade(account, open, mark, "ema9-below-ema21");
    }

    const unrealizedPct = Number(
      (((mark - open.entryPrice) / open.entryPrice) * 100).toFixed(3),
    );

    logScalp(`HOLD ${sym}`, {
      mark,
      ema9: snap?.ema9,
      ema21: snap?.ema21,
      atr14,
      stopLoss: dynamicStop,
      takeProfit: open.takeProfit,
      unrealizedPct,
    });

    notifyPaperScalpDecision({
      kind: "hold",
      reason: "holding-open-position",
      symbol: sym,
      details: {
        mark,
        unrealizedPct,
        stopLoss: dynamicStop,
        takeProfit: open.takeProfit,
        ema9: snap?.ema9,
        ema21: snap?.ema21,
        atr14,
        bearishCross: snap?.bearishCross ?? false,
      },
      throttleKey: `hold:${sym}`,
    });

    return { account, changed: false, summary: "holding-position" };
  }

  if (account.openPositions.length >= maxOpenForProfile(copyProfile)) {
    notifyPaperScalpDecision({
      kind: "skip",
      reason: "max-open-positions",
      details: {
        openCount: account.openPositions.length,
        maxAllowed: maxOpenForProfile(copyProfile),
        profile: copyProfile,
      },
      throttleKey: "max-open-positions",
    });
    return { account, changed: false, summary: "max-open-positions" };
  }

  const candidates = [...snapshots.values()]
    .filter((s) => s.bullishCross)
    .sort((a, b) => b.ema9 - b.ema21 - (a.ema9 - a.ema21));

  const entrySnap = candidates[0];
  if (!entrySnap) {
    const scanLines = [...snapshots.values()].map((s) =>
      formatSnapshotScanLine(normalizeSymbol(s.symbol), s),
    );
    notifyPaperScalpDecision({
      kind: "skip",
      reason: "no-ema-bullish-cross",
      details: {
        balance: account.currentBalance,
        symbolsScanned: snapshots.size,
        scan: scanLines.join(" · ") || "no snapshots",
      },
      throttleKey: "no-ema-bullish-cross",
    });
    return { account, changed: false, summary: "no-ema-bullish-cross" };
  }

  const sym = normalizeSymbol(entrySnap.symbol);
  const entryPrice = livePrice(sym, marketCoins, entrySnap.close);
  const notional = fractionalNotional(account.currentBalance);

  if (notional < 1 || account.currentBalance < notional) {
    logScalp("SKIP entry — insufficient balance", {
      balance: account.currentBalance,
      notional,
    });
    notifyPaperScalpDecision({
      kind: "skip",
      reason: "insufficient-balance",
      symbol: sym,
      details: {
        balance: account.currentBalance,
        requiredNotional: notional,
        positionFraction: POSITION_FRACTION,
      },
      throttleKey: `insufficient-balance:${sym}`,
    });
    return { account, changed: false, summary: "insufficient-balance" };
  }

  const { stopLoss, takeProfit, riskUsd, rewardUsd } = computeAtrStops(
    entryPrice,
    entrySnap.atr14,
    "long",
  );
  const amount = Number((notional / entryPrice).toFixed(6));

  logScalp(`BUY SIGNAL ${sym} | 9 EMA crossed above 21 EMA`, {
    entryPrice,
    ema9: Number(entrySnap.ema9.toFixed(6)),
    ema21: Number(entrySnap.ema21.toFixed(6)),
    atr14: Number(entrySnap.atr14.toFixed(8)),
    stopLoss,
    takeProfit,
    atrStopDistance: Number((entrySnap.atr14 * ATR_STOP_MULT).toFixed(8)),
    atrTpDistance: Number((entrySnap.atr14 * ATR_TP_MULT).toFixed(8)),
    riskRewardRatio: riskUsd > 0 ? Number((rewardUsd / riskUsd).toFixed(2)) : 2,
    positionSizeUsd: notional,
    positionFraction: POSITION_FRACTION,
    contracts: amount,
  });

  notifyPaperScalpBuy({
    symbol: sym,
    entryPrice,
    positionSizeUsd: notional,
    stopLoss,
    takeProfit,
    ema9: entrySnap.ema9,
    ema21: entrySnap.ema21,
    atr14: entrySnap.atr14,
  });

  const trade: DemoTrade = {
    id: `scalp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    signalId: `ema-cross-${sym}`,
    coinId: sym.replace(/USDT$/, "").toLowerCase(),
    symbol: sym,
    type: "buy",
    entryPrice,
    amount,
    value: notional,
    status: "open",
    openedAt: new Date(),
    stopLoss,
    takeProfit,
    trailingStopPct: undefined,
    followedSignal: false,
    notes: "1m EMA9/21 momentum scalp",
    tags: ["paper-scalp", "ema-cross", sym],
    executionNotes: [
      `ATR14=${entrySnap.atr14.toFixed(8)}`,
      `SL=1.5×ATR TP=3×ATR (1:2 RR)`,
    ],
  };

  return {
    account: {
      ...account,
      currentBalance: Math.max(0, account.currentBalance - notional),
      openPositions: [trade],
    },
    changed: true,
    summary: `opened:${sym}:ema-cross`,
  };
}
