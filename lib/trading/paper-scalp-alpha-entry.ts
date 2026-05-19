import {
  computeAtrStops,
  type Scalp1mSnapshot,
  type ScalpCandle,
} from "@/lib/trading/paper-scalp-indicators";
import {
  buildDeployLeaderboard,
  rankAltcoinMomentum,
} from "@/lib/trading/paper-scalp-momentum-rank";
import {
  rankMomentumCandidates,
  rankShortMomentumCandidates,
  resolvePaperMomentumSettings,
  type PaperMomentumBuyReason,
  type PaperMomentumShortReason,
} from "@/lib/trading/paper-scalp-momentum";
import { resolvePaperLiveMarkPrice } from "@/lib/trading/paper-scalp-mark-price";
import type { DynamicMarketRegime } from "@/lib/trading/paper-scalp-regime";
import {
  pickVelocityBreakdownCandidate,
  pickVelocityBreakoutCandidate,
} from "@/lib/trading/paper-scalp-velocity";
import { computeOpenEndedTakeProfit } from "@/lib/trading/paper-scalp-trailing-exit";
import type { PaperScalpWorkspaceSettings } from "@/lib/trading/paper-scalp-settings";
import type { PaperLegSide } from "@/lib/trading/paper-scalp-leg-side";
import type { CoinData, DemoTrade } from "@/lib/types";

export type AlphaEntryPick = {
  snap: Scalp1mSnapshot;
  reason: string;
  side: PaperLegSide;
};

function normalizeSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

export function resolveAlphaEntryPick(params: {
  regime: DynamicMarketRegime;
  watch: string[];
  snapshots: Map<string, Scalp1mSnapshot>;
  candlesBySymbol: Map<string, ScalpCandle[]>;
  held: Set<string>;
  paperSettings: PaperScalpWorkspaceSettings;
  rsiMaxBuy: number;
}): AlphaEntryPick | null {
  const { regime, watch, snapshots, candlesBySymbol, held, paperSettings, rsiMaxBuy } =
    params;
  const momentum = resolvePaperMomentumSettings(paperSettings, rsiMaxBuy);

  const momentumRanked = rankAltcoinMomentum({
    symbols: watch,
    snapshots,
    candlesBySymbol,
    regime,
    held,
  });
  const leaders = buildDeployLeaderboard(momentumRanked, regime.deployTopN);
  const deploySet = new Set(leaders.map((row) => row.symbol));

  const pool = [...snapshots.values()].filter((s) => {
    const sym = normalizeSymbol(s.symbol);
    return watch.includes(sym) && !held.has(sym) && deploySet.has(sym);
  });

  if (regime.entryMode === "short") {
    const velocityPick = pickVelocityBreakdownCandidate({
      symbols: watch,
      snapshots,
      candlesBySymbol,
      held,
    });
    if (velocityPick) {
      return {
        snap: velocityPick.snap,
        reason: "velocity_breakdown",
        side: "SHORT",
      };
    }

    const ranked = rankShortMomentumCandidates(pool, momentum);
    const row = ranked[0];
    if (row) {
      return {
        snap: row.snap,
        reason: row.evaluation.reason as PaperMomentumShortReason,
        side: "SHORT",
      };
    }
    return null;
  }

  const velocityPick = pickVelocityBreakoutCandidate({
    symbols: watch,
    snapshots,
    candlesBySymbol,
    held,
  });
  if (velocityPick) {
    return {
      snap: velocityPick.snap,
      reason: "velocity_breakout",
      side: "LONG",
    };
  }

  const ranked = rankMomentumCandidates(pool, momentum);
  const row = ranked[0];
  if (!row) return null;

  return {
    snap: row.snap,
    reason: row.evaluation.reason as PaperMomentumBuyReason,
    side: "LONG",
  };
}

export function buildAlphaEntryTrade(params: {
  pick: AlphaEntryPick;
  regime: DynamicMarketRegime;
  marketCoins: CoinData[];
  positionSizeUsdt: number;
}): DemoTrade {
  const { pick, regime, marketCoins, positionSizeUsdt } = params;
  const sym = normalizeSymbol(pick.snap.symbol);
  const isShort = pick.side === "SHORT";
  const entryPrice = resolvePaperLiveMarkPrice(
    sym,
    marketCoins,
    pick.snap.close,
  );
  const entryAtr =
    pick.snap.atr14 > 0 ? pick.snap.atr14 : Math.max(entryPrice * 0.01, 1e-8);
  const stopSide = isShort ? "short" : "long";
  const stopPlan = computeAtrStops(entryPrice, entryAtr, stopSide);
  const softTakeProfit = computeOpenEndedTakeProfit(entryPrice, entryAtr, stopSide);
  const amount = Number((positionSizeUsdt / entryPrice).toFixed(6));
  const regimeTag = isShort ? "active-short" : regime.state;

  return {
    id: `scalp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    signalId: `alpha-${pick.reason}-${sym}`,
    coinId: sym.replace(/USDT$/, "").toLowerCase(),
    symbol: sym,
    type: isShort ? "sell" : "buy",
    direction: pick.side,
    entryPrice,
    amount,
    value: positionSizeUsdt,
    status: "open",
    openedAt: new Date(),
    stopLoss: stopPlan.stopLoss,
    takeProfit: softTakeProfit,
    highestPriceReached: isShort ? undefined : entryPrice,
    lowestPriceReached: isShort ? entryPrice : undefined,
    originalEntryPrice: entryPrice,
    initialPositionValueUsdt: positionSizeUsdt,
    pyramidLayers: 0,
    pyramidAddedUsdt: 0,
    velocityTakeProfitSecured: false,
    notes: `15m alpha ${pick.reason} (${regimeTag}) · trailing exit`,
    followedSignal: false,
    tags: [
      "paper-scalp",
      "alpha-15m",
      "atr-trail",
      pick.reason,
      regimeTag,
      sym,
      isShort ? "short-leg" : "long-leg",
    ],
    executionNotes: [
      `regime=${regimeTag}`,
      `side=${pick.side}`,
      pick.reason.includes("velocity")
        ? `velocity candle ±1.2% or RVOL gate`
        : `trendScore=${regime.trendScore.score}`,
      isShort ? "trail=trough+1.5xATR" : "trail=peak-1.5xATR",
    ],
  };
}
