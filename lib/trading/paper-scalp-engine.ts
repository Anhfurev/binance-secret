import {
  computeAtrStops,
  type Scalp1mSnapshot,
} from "@/lib/trading/paper-scalp-indicators";
import { maybeResetPaperDailyPnl } from "@/lib/trading/paper-scalp-daily";
import { formatMicroPrice } from "@/lib/trading/micro-price";
import { computePaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import {
  evaluateOpenPaperPosition,
} from "@/lib/trading/paper-scalp-positions";
import {
  computePaperPositionSizeUsdt,
  PAPER_MIN_NOTIONAL_USDT,
  type PaperScalpWorkspaceSettings,
} from "@/lib/trading/paper-scalp-settings";
import type { PaperAutomationTickResult } from "@/lib/trading/paper-scalp-types";
import type { CoinData, DemoAccount, DemoTrade } from "@/lib/types";

export type { PaperAutomationTickResult };

const ATR_STOP_MULT = 1.5;
const ATR_TP_MULT = 3;
const DEFAULT_RSI_MAX_BUY = 70;

function resolveRsiMaxBuy(): number {
  const raw = String(process.env.PAPER_RSI_MAX_BUY ?? "").trim();
  const n = raw ? Number(raw) : DEFAULT_RSI_MAX_BUY;
  if (!Number.isFinite(n) || n <= 50) return DEFAULT_RSI_MAX_BUY;
  return Math.min(n, 90);
}

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

export function runPaperScalp1hTick(params: {
  account: DemoAccount;
  snapshots: Map<string, Scalp1mSnapshot>;
  marketCoins: CoinData[];
  paperSettings: PaperScalpWorkspaceSettings;
}): PaperAutomationTickResult {
  const { snapshots, marketCoins, paperSettings } = params;
  let account = maybeResetPaperDailyPnl(params.account);

  if (account.circuitBreakerTripped) {
    return { account, changed: false, summary: "circuit-breaker" };
  }

  let stopsAdjusted = false;
  for (const open of [...account.openPositions]) {
    const evalResult = evaluateOpenPaperPosition({
      account,
      trade: open,
      snapshots,
      marketCoins,
    });
    account = evalResult.account;
    if (evalResult.stopAdjusted) stopsAdjusted = true;
    if (evalResult.exit?.changed) return evalResult.exit;
  }

  if (account.openPositions.length > 0) {
    const sym = normalizeSymbol(account.openPositions[0].symbol);
    const snap = snapshots.get(sym);
    const mark = livePrice(
      sym,
      marketCoins,
      snap?.close ?? account.openPositions[0].entryPrice,
    );
    logScalp(`HOLD ${account.openPositions.length} open leg(s)`, {
      symbols: account.openPositions.map((p) => p.symbol),
      mark,
    });
    return {
      account,
      changed: stopsAdjusted,
      summary: "holding-position",
    };
  }

  const maxOpen = paperSettings.maxOpenPositions;
  if (account.openPositions.length >= maxOpen) {
    logScalp("SKIP — max open positions", {
      open: account.openPositions.length,
      maxOpen,
    });
    return { account, changed: false, summary: "max-open-positions-reached" };
  }

  const held = new Set(
    account.openPositions.map((p) => normalizeSymbol(p.symbol)),
  );
  const watch = new Set(
    paperSettings.symbols.map((s) => normalizeSymbol(s)),
  );

  const candidates = [...snapshots.values()]
    .filter(
      (s) =>
        watch.has(normalizeSymbol(s.symbol)) &&
        !held.has(normalizeSymbol(s.symbol)) &&
        s.bullishCross,
    )
    .sort((a, b) => b.ema9 - b.ema21 - (a.ema9 - a.ema21));

  const entrySnap = candidates[0];
  if (!entrySnap) {
    return { account, changed: false, summary: "no-ema-bullish-cross" };
  }

  const rsiMax = resolveRsiMaxBuy();
  if (entrySnap.rsi14 > rsiMax) {
    logScalp(`SKIP ${entrySnap.symbol} — RSI overbought`, {
      rsi14: entrySnap.rsi14,
      rsiMax,
    });
    return { account, changed: false, summary: "rsi-overbought" };
  }

  const sym = normalizeSymbol(entrySnap.symbol);
  const entryPrice = livePrice(sym, marketCoins, entrySnap.close);
  const nav = computePaperWorkspaceNav(account, marketCoins);
  const freeBalanceUsdt = nav.available_usdt;
  const positionSizeUsdt = computePaperPositionSizeUsdt(
    freeBalanceUsdt,
    paperSettings.riskPerTradePercent,
  );

  if (freeBalanceUsdt < positionSizeUsdt) {
    logScalp("SKIP — insufficient free margin for min notional floor", {
      freeBalanceUsdt,
      positionSizeUsdt,
      floor: PAPER_MIN_NOTIONAL_USDT,
      riskPct: paperSettings.riskPerTradePercent,
    });
    return { account, changed: false, summary: "insufficient-free-margin-floor" };
  }

  if (positionSizeUsdt > freeBalanceUsdt) {
    return { account, changed: false, summary: "insufficient-free-margin-floor" };
  }

  const { stopLoss, takeProfit, riskUsd, rewardUsd } = computeAtrStops(
    entryPrice,
    entrySnap.atr14,
    "long",
  );
  const amount = Number((positionSizeUsdt / entryPrice).toFixed(6));

  logScalp(`BUY SIGNAL ${sym} | 1h EMA9 crossed above EMA21`, {
    entryPrice: formatMicroPrice(entryPrice),
    ema9: formatMicroPrice(entrySnap.ema9),
    ema21: formatMicroPrice(entrySnap.ema21),
    rsi14: entrySnap.rsi14.toFixed(2),
    atr14: formatMicroPrice(entrySnap.atr14),
    nav: nav.portfolio_nav_usdt,
    freeBalanceUsdt,
    positionSizeUsdt,
    riskPerTradePercent: paperSettings.riskPerTradePercent,
    minNotionalFloor: PAPER_MIN_NOTIONAL_USDT,
    stopLoss,
    takeProfit,
    atrStopDistance: Number((entrySnap.atr14 * ATR_STOP_MULT).toFixed(8)),
    atrTpDistance: Number((entrySnap.atr14 * ATR_TP_MULT).toFixed(8)),
    riskRewardRatio: riskUsd > 0 ? Number((rewardUsd / riskUsd).toFixed(2)) : 2,
    openSlots: `${account.openPositions.length}/${maxOpen}`,
    contracts: amount,
  });

  const trade: DemoTrade = {
    id: `scalp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    signalId: `ema-cross-${sym}`,
    coinId: sym.replace(/USDT$/, "").toLowerCase(),
    symbol: sym,
    type: "buy",
    entryPrice,
    amount,
    value: positionSizeUsdt,
    status: "open",
    openedAt: new Date(),
    stopLoss,
    takeProfit,
    trailingStopPct: undefined,
    followedSignal: false,
    notes: "1h EMA9/21 + RSI14 momentum",
    tags: ["paper-scalp", "ema-cross", sym],
    executionNotes: [
      `ATR14=${entrySnap.atr14.toFixed(8)}`,
      `SL=1.5×ATR TP=3×ATR`,
      `size=$${positionSizeUsdt} risk=${paperSettings.riskPerTradePercent}%`,
    ],
  };

  return {
    account: {
      ...account,
      currentBalance: Math.max(0, account.currentBalance - positionSizeUsdt),
      openPositions: [...account.openPositions, trade],
    },
    changed: true,
    summary: `opened:${sym}:ema-cross`,
  };
}

/** @deprecated Alias — use runPaperScalp1hTick */
export const runPaperScalp1mTick = runPaperScalp1hTick;
