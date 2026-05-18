import {
  computeAtrStops,
  type Scalp1mSnapshot,
  type ScalpCandle,
} from "@/lib/trading/paper-scalp-indicators";
import { MAX_OPEN_LEGS_PER_WORKSPACE } from "@/lib/trading/paper-scalp-correlation";
import { maybeResetPaperDailyPnl } from "@/lib/trading/paper-scalp-daily";
import { resolvePaperLiveMarkPrice } from "@/lib/trading/paper-scalp-mark-price";
import {
  buildDeployLeaderboard,
  rankAltcoinMomentum,
} from "@/lib/trading/paper-scalp-momentum-rank";
import {
  rankMomentumCandidates,
  resolvePaperMomentumSettings,
  type PaperMomentumBuyReason,
} from "@/lib/trading/paper-scalp-momentum";
import { evaluateOpenPaperPosition } from "@/lib/trading/paper-scalp-positions";
import { tryPyramidLayerOnOpenLeg } from "@/lib/trading/paper-scalp-pyramid";
import { computeOpenEndedTakeProfit } from "@/lib/trading/paper-scalp-trailing-exit";
import { pickVelocityBreakoutCandidate } from "@/lib/trading/paper-scalp-velocity";
import {
  calculateDynamicRegime,
  resolveBtcCandles,
  resolveBtcSnapshot,
} from "@/lib/trading/paper-scalp-regime";
import {
  computePaperPositionSizeUsdt,
  type PaperScalpWorkspaceSettings,
} from "@/lib/trading/paper-scalp-settings";
import type { PaperAutomationTickResult } from "@/lib/trading/paper-scalp-types";
import { computePaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import type { CoinData, DemoAccount, DemoTrade } from "@/lib/types";

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

function withTickMeta(
  result: PaperAutomationTickResult,
  meta: Partial<PaperAutomationTickResult>,
): PaperAutomationTickResult {
  return { ...result, ...meta };
}

/**
 * Alpha engine tick — 15m regime, velocity breakout, trail, pyramid, 70/30 TP.
 */
export function runPaperScalpAlphaTick(params: {
  account: DemoAccount;
  snapshots: Map<string, Scalp1mSnapshot>;
  candlesBySymbol: Map<string, ScalpCandle[]>;
  marketCoins: CoinData[];
  paperSettings: PaperScalpWorkspaceSettings;
  apiDegraded?: boolean;
}): PaperAutomationTickResult {
  const { snapshots, candlesBySymbol, marketCoins, paperSettings } = params;
  let account = maybeResetPaperDailyPnl(params.account);

  let stopsAdjusted = false;
  let pyramided = false;
  let velocityPartial = false;

  for (const open of [...account.openPositions]) {
    const evalResult = evaluateOpenPaperPosition({
      account,
      trade: open,
      snapshots,
      marketCoins,
    });
    account = evalResult.account;
    if (evalResult.stopAdjusted) stopsAdjusted = true;
    if (evalResult.velocityPartial) velocityPartial = true;
    if (evalResult.exit?.changed) {
      return withTickMeta(evalResult.exit, {
        positionClosed: true,
        velocityPartial: velocityPartial || undefined,
        pyramided: pyramided || undefined,
      });
    }
  }

  const openLegIds = account.openPositions.map((p) => p.id);
  for (const legId of openLegIds) {
    const leg = account.openPositions.find((p) => p.id === legId);
    if (!leg) continue;

    const pyramidResult = tryPyramidLayerOnOpenLeg({
      account,
      trade: leg,
      snapshots,
      marketCoins,
    });
    account = pyramidResult.account;
    if (pyramidResult.pyramided) {
      pyramided = true;
      stopsAdjusted = true;
    }
  }

  if (velocityPartial) {
    const sym =
      account.openPositions.find((p) => p.velocityTakeProfitSecured)?.symbol ??
      "unknown";
    return withTickMeta(
      {
        account,
        changed: true,
        summary: `velocity-tp-70:${normalizeSymbol(sym)}`,
      },
      { velocityPartial: true, pyramided: pyramided || undefined },
    );
  }

  const openLegCount = account.openPositions.length;
  const maxLegs = Math.min(
    paperSettings.maxOpenPositions,
    MAX_OPEN_LEGS_PER_WORKSPACE,
  );

  if (account.circuitBreakerTripped) {
    if (openLegCount > 0) {
      return withTickMeta(
        {
          account,
          changed: stopsAdjusted || pyramided,
          summary: pyramided ? "pyramid-layer-added" : "holding-position",
        },
        { pyramided: pyramided || undefined },
      );
    }
    return { account, changed: false, summary: "circuit-breaker" };
  }

  if (openLegCount >= maxLegs) {
    return withTickMeta(
      {
        account,
        changed: stopsAdjusted || pyramided,
        summary: pyramided ? "pyramid-layer-added" : "max-open-positions-reached",
      },
      { pyramided: pyramided || undefined },
    );
  }

  const regime = calculateDynamicRegime({
    btcSnapshot: resolveBtcSnapshot(snapshots),
    btcCandles: resolveBtcCandles(candlesBySymbol),
    apiDegraded: params.apiDegraded,
  });

  if (regime.blockAltcoinEntries) {
    if (openLegCount > 0) {
      return withTickMeta(
        {
          account,
          changed: stopsAdjusted || pyramided,
          summary: pyramided ? "pyramid-layer-added" : "holding-position",
        },
        { pyramided: pyramided || undefined },
      );
    }
    return { account, changed: false, summary: "alpha-risk-off" };
  }

  const held = new Set(
    account.openPositions.map((p) => normalizeSymbol(p.symbol)),
  );
  const watch = paperSettings.symbols.map((s) => normalizeSymbol(s));

  const momentumRanked = rankAltcoinMomentum({
    symbols: watch,
    snapshots,
    candlesBySymbol,
    regime,
    held,
  });
  const leaders = buildDeployLeaderboard(momentumRanked, regime.deployTopN);
  const deploySet = new Set(leaders.map((row) => row.symbol));

  const momentum = resolvePaperMomentumSettings(
    paperSettings,
    resolveRsiMaxBuy(),
  );

  const velocityPick = pickVelocityBreakoutCandidate({
    symbols: watch,
    snapshots,
    candlesBySymbol,
    held,
  });

  const pool = [...snapshots.values()].filter((s) => {
    const sym = normalizeSymbol(s.symbol);
    return watch.includes(sym) && !held.has(sym) && deploySet.has(sym);
  });

  const ranked = rankMomentumCandidates(pool, momentum);
  const momentumPick = ranked[0];

  let entrySnap: Scalp1mSnapshot | null = null;
  let buyReason: PaperMomentumBuyReason = "trend_resumption";

  if (velocityPick) {
    entrySnap = velocityPick.snap;
    buyReason = "velocity_breakout";
  } else if (momentumPick) {
    entrySnap = momentumPick.snap;
    buyReason = momentumPick.evaluation.reason as PaperMomentumBuyReason;
  }

  if (!entrySnap) {
    if (openLegCount > 0) {
      return withTickMeta(
        {
          account,
          changed: stopsAdjusted || pyramided,
          summary: pyramided ? "pyramid-layer-added" : "holding-position",
        },
        { pyramided: pyramided || undefined },
      );
    }
    return { account, changed: false, summary: "no-signal" };
  }

  const sym = normalizeSymbol(entrySnap.symbol);
  const entryPrice = resolvePaperLiveMarkPrice(sym, marketCoins, entrySnap.close);
  const nav = computePaperWorkspaceNav(account, marketCoins);
  const baseSize = computePaperPositionSizeUsdt(
    nav.portfolio_nav_usdt,
    paperSettings.riskPerTradePercent,
  );
  const positionSizeUsdt = Number(
    (baseSize.sizeUsdt * regime.altSizeMultiplier).toFixed(4),
  );

  if (positionSizeUsdt <= 0 || nav.available_usdt < positionSizeUsdt) {
    return { account, changed: false, summary: "insufficient-free-margin-floor" };
  }

  const entryAtr =
    entrySnap.atr14 > 0 ? entrySnap.atr14 : Math.max(entryPrice * 0.01, 1e-8);
  const stopPlan = computeAtrStops(entryPrice, entryAtr, "long");
  const softTakeProfit = computeOpenEndedTakeProfit(entryPrice, entryAtr);
  const amount = Number((positionSizeUsdt / entryPrice).toFixed(6));

  const trade: DemoTrade = {
    id: `scalp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    signalId: `alpha-${buyReason}-${sym}`,
    coinId: sym.replace(/USDT$/, "").toLowerCase(),
    symbol: sym,
    type: "buy",
    entryPrice,
    amount,
    value: positionSizeUsdt,
    status: "open",
    openedAt: new Date(),
    stopLoss: stopPlan.stopLoss,
    takeProfit: softTakeProfit,
    highestPriceReached: entryPrice,
    originalEntryPrice: entryPrice,
    initialPositionValueUsdt: positionSizeUsdt,
    pyramidLayers: 0,
    pyramidAddedUsdt: 0,
    velocityTakeProfitSecured: false,
    notes: `15m alpha ${buyReason} (${regime.state}) · trailing exit`,
    followedSignal: false,
    tags: ["paper-scalp", "alpha-15m", "atr-trail", buyReason, regime.state, sym],
    executionNotes: [
      `regime=${regime.state}`,
      buyReason === "velocity_breakout"
        ? `velocity rvol>${2} rsi>60`
        : `trendScore=${regime.trendScore.score}`,
      "trail=peak-1.5xATR",
    ],
  };

  return withTickMeta(
    {
      account: {
        ...account,
        currentBalance: Math.max(0, account.currentBalance - positionSizeUsdt),
        openPositions: [...account.openPositions, trade],
      },
      changed: true,
      summary: `opened:${sym}:${buyReason}`,
    },
    { entryExecuted: true, pyramided: pyramided || undefined },
  );
}
