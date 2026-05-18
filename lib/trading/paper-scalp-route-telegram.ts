import type { CoinData, DemoAccount } from "@/lib/types";
import type { Scalp1mSnapshot } from "@/lib/trading/paper-scalp-indicators";
import { computePaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import {
  formatSnapshotScanLine,
  notifyPaperScalpBuy,
  notifyPaperScalpDecision,
  notifyPaperScalpExit,
} from "@/lib/trading/paper-scalp-telegram";

function normSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

/** Sync guard — never throws into the trading tick / route handler. */
export function safePaperScalpRouteTelegram(dispatch: () => void): void {
  try {
    dispatch();
  } catch (err) {
    console.error("[TELEGRAM-ROUTE-ERROR]", err);
  }
}

export function relayPaperScalpTickTelegram(params: {
  summary: string;
  account: DemoAccount;
  scalpSnapshots: Map<string, Scalp1mSnapshot>;
  marketCoins?: CoinData[];
}): void {
  const { summary, account, scalpSnapshots, marketCoins = [] } = params;
  const nav = computePaperWorkspaceNav(account, marketCoins);
  const openLegCount = account.openPositions.length;

  if (summary.startsWith("opened:")) {
    const trade = account.openPositions[0];
    if (!trade) return;
    const sym = normSymbol(trade.symbol);
    const snap = scalpSnapshots.get(sym);
    notifyPaperScalpBuy({
      symbol: sym,
      entryPrice: trade.entryPrice,
      positionSizeUsd: trade.value,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      ema9: snap?.ema9 ?? 0,
      ema21: snap?.ema21 ?? 0,
      atr14: snap?.atr14 ?? 0,
      rsi14: snap?.rsi14 ?? 50,
      nav,
      openLegCount,
    });
    return;
  }

  if (summary.startsWith("closed:")) {
    const parts = summary.split(":");
    const sym = normSymbol(parts[1] ?? "");
    const reason = parts.slice(2).join(":") || "exit";
    const trade = account.tradeHistory[0];
    if (!trade || normSymbol(trade.symbol) !== sym) return;
    notifyPaperScalpExit({
      symbol: sym,
      reason,
      exitPrice: trade.exitPrice ?? trade.entryPrice,
      performancePct: trade.pnlPercent ?? 0,
      entryPrice: trade.entryPrice,
      pnlUsd: trade.pnl,
      nav,
      openLegCount: account.openPositions.length,
    });
    return;
  }

  if (summary === "holding-position") {
    const open = account.openPositions[0];
    if (!open) return;
    const sym = normSymbol(open.symbol);
    const snap = scalpSnapshots.get(sym);
    notifyPaperScalpDecision({
      kind: "hold",
      reason: "holding-position",
      symbol: sym,
      details: {
        entryPrice: open.entryPrice,
        stopLoss: open.stopLoss,
        takeProfit: open.takeProfit,
        ema9: snap?.ema9,
        ema21: snap?.ema21,
        rsi14: snap?.rsi14,
        atr14: snap?.atr14,
        bearishCross: snap?.bearishCross ?? false,
      },
      throttleKey: `hold:${sym}`,
      nav,
      openLegCount,
    });
    return;
  }

  if (summary === "no-signal" || summary === "no-ema-bullish-cross") {
    const scanLines = [...scalpSnapshots.values()].map((s) =>
      formatSnapshotScanLine(normSymbol(s.symbol), s),
    );
    notifyPaperScalpDecision({
      kind: "skip",
      reason: summary,
      details: {
        symbolsScanned: scalpSnapshots.size,
        scan: scanLines.join(" · ") || "no snapshots",
      },
      throttleKey: "no-ema-bullish-cross",
      nav,
      openLegCount,
    });
    return;
  }

  if (summary === "rsi-overbought") {
    notifyPaperScalpDecision({
      kind: "skip",
      reason: summary,
      details: {
        rsiMax: Number(process.env.PAPER_RSI_MAX_BUY ?? 70),
      },
      throttleKey: "rsi-overbought",
      nav,
      openLegCount,
    });
    return;
  }

  if (
    summary === "insufficient-balance" ||
    summary === "insufficient-free-margin-floor"
  ) {
    notifyPaperScalpDecision({
      kind: "skip",
      reason: summary,
      details: {
        freeCash: nav.available_usdt,
        minNotionalFloor: 5.5,
        liveNav: nav.portfolio_nav_usdt,
        openUnrealizedPnl: nav.open_unrealized_pnl_usdt,
      },
      throttleKey: summary,
      nav,
      openLegCount,
    });
    return;
  }

  if (
    summary === "max-open-positions-reached" ||
    summary === "max-open-positions"
  ) {
    notifyPaperScalpDecision({
      kind: "skip",
      reason: summary,
      details: { openCount: account.openPositions.length },
      throttleKey: "max-open-positions-reached",
      nav,
      openLegCount,
    });
    return;
  }

  if (summary === "no-hourly-snapshots" || summary === "no-1m-snapshots") {
    notifyPaperScalpDecision({
      kind: "skip",
      reason: "no-hourly-snapshots",
      details: { hint: "1h klines fetch failed or symbols empty" },
      throttleKey: "no-hourly-snapshots",
      nav,
      openLegCount,
    });
    return;
  }

  notifyPaperScalpDecision({
    kind: "skip",
    reason: summary,
    details:
      summary === "circuit-breaker"
        ? { dailyPnl: account.dailyPnl ?? 0 }
        : summary === "max-open-positions"
          ? { openCount: account.openPositions.length }
          : undefined,
    throttleKey: summary,
    nav,
    openLegCount,
  });
}
