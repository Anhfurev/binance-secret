import {
  computeAtrStops,
  type Scalp1mSnapshot,
} from "@/lib/trading/paper-scalp-indicators";
import { logPaperScalpActiveLine } from "@/lib/trading/paper-scalp-active-log";
import { maybeResetPaperDailyPnl } from "@/lib/trading/paper-scalp-daily";
import { formatAssetPrice } from "@/lib/trading/paper-scalp-metrics-format";
import { resolvePaperLiveMarkPrice } from "@/lib/trading/paper-scalp-mark-price";
import {
  computePaperWorkspaceNav,
  formatNavLogLine,
} from "@/lib/trading/paper-scalp-nav";
import { evaluateOpenPaperPosition } from "@/lib/trading/paper-scalp-positions";
import {
  rankMomentumCandidates,
  resolvePaperMomentumSettings,
  type PaperMomentumBuyReason,
} from "@/lib/trading/paper-scalp-momentum";
import {
  computePaperPositionSizeUsdt,
  type PaperScalpWorkspaceSettings,
} from "@/lib/trading/paper-scalp-settings";
import type { PaperAutomationTickResult } from "@/lib/trading/paper-scalp-types";
import type { CoinData, DemoAccount, DemoTrade } from "@/lib/types";

export type { PaperAutomationTickResult };

const ATR_STOP_MULT = 1.5;
const ATR_TP_MULT = 3;

function resolveRsiMaxBuy(): number {
  const raw = String(process.env.PAPER_RSI_MAX_BUY ?? "").trim();
  const n = raw ? Number(raw) : 70;
  if (!Number.isFinite(n) || n <= 50) return 70;
  return Math.min(n, 90);
}

function normalizeSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
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
    logPaperScalpActiveLine({
      symbol: sym,
      action: "HOLD",
      reason: "managing_open",
      snap: snapshots.get(sym),
    });
    return {
      account,
      changed: stopsAdjusted,
      summary: "holding-position",
    };
  }

  if (account.openPositions.length >= paperSettings.maxOpenPositions) {
    return { account, changed: false, summary: "max-open-positions-reached" };
  }

  const momentum = resolvePaperMomentumSettings(
    paperSettings,
    resolveRsiMaxBuy(),
  );
  const held = new Set(
    account.openPositions.map((p) => normalizeSymbol(p.symbol)),
  );
  const watch = new Set(
    paperSettings.symbols.map((s) => normalizeSymbol(s)),
  );

  const pool = [...snapshots.values()].filter(
    (s) =>
      watch.has(normalizeSymbol(s.symbol)) &&
      !held.has(normalizeSymbol(s.symbol)),
  );

  const ranked = rankMomentumCandidates(pool, momentum);
  const pick = ranked[0];

  if (!pick) {
    return { account, changed: false, summary: "no-signal" };
  }

  const entrySnap = pick.snap;
  const buyReason = pick.evaluation.reason as PaperMomentumBuyReason;
  const sym = normalizeSymbol(entrySnap.symbol);

  logPaperScalpActiveLine({
    symbol: sym,
    action: "BUY",
    reason: buyReason,
    snap: entrySnap,
  });

  const entryPrice = resolvePaperLiveMarkPrice(
    sym,
    marketCoins,
    entrySnap.close,
  );
  const nav = computePaperWorkspaceNav(account, marketCoins);
  const { sizeUsdt: positionSizeUsdt, appliedMinFloor } =
    computePaperPositionSizeUsdt(
      nav.portfolio_nav_usdt,
      paperSettings.riskPerTradePercent,
    );

  if (positionSizeUsdt <= 0 || nav.available_usdt < positionSizeUsdt) {
    return { account, changed: false, summary: "insufficient-free-margin-floor" };
  }

  const { stopLoss, takeProfit, riskUsd, rewardUsd } = computeAtrStops(
    entryPrice,
    entrySnap.atr14,
    "long",
  );
  const amount = Number((positionSizeUsdt / entryPrice).toFixed(6));

  console.log(`[paper-scalp] BUY ${sym} | ${buyReason}`, {
    entryPrice: formatAssetPrice(entryPrice),
    rsi14: entrySnap.rsi14.toFixed(2),
    positionSizeUsdt,
    navPct: paperSettings.riskPerTradePercent,
    minFloor: appliedMinFloor,
    navSummary: formatNavLogLine(nav),
    riskRewardRatio: riskUsd > 0 ? Number((rewardUsd / riskUsd).toFixed(2)) : 2,
  });

  const trade: DemoTrade = {
    id: `scalp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    signalId: `momentum-${buyReason}-${sym}`,
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
    notes: `1h momentum ${buyReason}`,
    tags: ["paper-scalp", buyReason, sym],
    executionNotes: [
      `ATR14=${entrySnap.atr14.toFixed(8)}`,
      `SL=1.5×ATR TP=3×ATR`,
      `size=$${positionSizeUsdt}`,
    ],
  };

  return {
    account: {
      ...account,
      currentBalance: Math.max(0, account.currentBalance - positionSizeUsdt),
      openPositions: [...account.openPositions, trade],
    },
    changed: true,
    summary: `opened:${sym}:${buyReason}`,
  };
}

export const runPaperScalp1mTick = runPaperScalp1hTick;
