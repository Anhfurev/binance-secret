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
    });
    return;
  }

  if (summary === "no-ema-bullish-cross") {
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
    });
    return;
  }

  if (summary === "insufficient-balance") {
    notifyPaperScalpDecision({
      kind: "skip",
      reason: summary,
      details: {
        requiredNotional: Number((nav.portfolio_nav_usdt * 0.2).toFixed(2)),
        available: nav.available_usdt,
      },
      throttleKey: "insufficient-balance",
      nav,
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
  });
}
