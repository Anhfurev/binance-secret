import type { Scalp1mSnapshot, ScalpCandle } from "@/lib/trading/paper-scalp-indicators";
import { MAX_OPEN_LEGS_PER_WORKSPACE } from "@/lib/trading/paper-scalp-correlation";
import { maybeResetPaperDailyPnl } from "@/lib/trading/paper-scalp-daily";
import {
  buildAlphaEntryTrade,
  resolveAlphaEntryPick,
} from "@/lib/trading/paper-scalp-alpha-entry";
import { evaluateOpenPaperPosition } from "@/lib/trading/paper-scalp-positions";
import { tryPyramidLayerOnOpenLeg } from "@/lib/trading/paper-scalp-pyramid";
import { formatVelocityTp70Summary } from "@/lib/trading/paper-scalp-velocity";
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
import type { CoinData, DemoAccount } from "@/lib/types";

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
 * Alpha engine tick — 15m regime, velocity breakout/breakdown, trail, pyramid, 70/30 TP.
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
  const velocityPartialSymbols: string[] = [];
  let positionClosed = false;
  const closeSummaries: string[] = [];

  const legsToEvaluate = [...account.openPositions];
  for (const leg of legsToEvaluate) {
    const open = account.openPositions.find((p) => p.id === leg.id);
    if (!open) continue;

    const evalResult = evaluateOpenPaperPosition({
      account,
      trade: open,
      snapshots,
      marketCoins,
    });
    account = evalResult.account;
    if (evalResult.stopAdjusted) stopsAdjusted = true;
    if (evalResult.velocityPartial) {
      velocityPartial = true;
      velocityPartialSymbols.push(normalizeSymbol(open.symbol));
    }
    if (evalResult.exit?.changed) {
      positionClosed = true;
      closeSummaries.push(evalResult.exit.summary);
      account = evalResult.exit.account;
    }
  }

  const lastCloseSummary =
    closeSummaries.length > 0
      ? closeSummaries[closeSummaries.length - 1]!
      : null;

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

  const openLegCount = account.openPositions.length;

  if (velocityPartial) {
    return withTickMeta(
      {
        account,
        changed: true,
        summary: formatVelocityTp70Summary(velocityPartialSymbols),
      },
      {
        velocityPartial: true,
        velocityPartialSymbols,
        positionClosed: positionClosed || undefined,
        pyramided: pyramided || undefined,
      },
    );
  }

  if (lastCloseSummary && openLegCount === 0) {
    return withTickMeta(
      { account, changed: true, summary: lastCloseSummary },
      { positionClosed: true, pyramided: pyramided || undefined },
    );
  }

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

  const entryPick = resolveAlphaEntryPick({
    regime,
    watch,
    snapshots,
    candlesBySymbol,
    held,
    paperSettings,
    rsiMaxBuy: resolveRsiMaxBuy(),
  });

  if (!entryPick) {
    if (lastCloseSummary) {
      return withTickMeta(
        { account, changed: true, summary: lastCloseSummary },
        {
          positionClosed: true,
          velocityPartial: velocityPartial || undefined,
          pyramided: pyramided || undefined,
        },
      );
    }
    if (openLegCount > 0) {
      return withTickMeta(
        {
          account,
          changed: stopsAdjusted || pyramided || velocityPartial,
          summary: pyramided
            ? "pyramid-layer-added"
            : velocityPartial
              ? formatVelocityTp70Summary(velocityPartialSymbols)
              : "holding-position",
        },
        {
          pyramided: pyramided || undefined,
          velocityPartial: velocityPartial || undefined,
          velocityPartialSymbols: velocityPartialSymbols.length
            ? velocityPartialSymbols
            : undefined,
        },
      );
    }
    return {
      account,
      changed: stopsAdjusted || velocityPartial,
      summary: regime.entryMode === "short" ? "no-short-signal" : "no-signal",
    };
  }

  const sym = normalizeSymbol(entryPick.snap.symbol);
  const nav = computePaperWorkspaceNav(account, marketCoins);
  const baseSize = computePaperPositionSizeUsdt(
    nav.portfolio_nav_usdt,
    paperSettings.riskPerTradePercent,
  );
  const positionSizeUsdt = Number(
    (baseSize.sizeUsdt * regime.altSizeMultiplier).toFixed(4),
  );

  if (positionSizeUsdt <= 0 || nav.available_usdt < positionSizeUsdt) {
    if (lastCloseSummary) {
      return withTickMeta(
        { account, changed: true, summary: lastCloseSummary },
        { positionClosed: true, pyramided: pyramided || undefined },
      );
    }
    return withTickMeta(
      {
        account,
        changed: stopsAdjusted || pyramided || velocityPartial,
        summary: "insufficient-free-margin-floor",
      },
      { pyramided: pyramided || undefined, velocityPartial: velocityPartial || undefined },
    );
  }

  const trade = buildAlphaEntryTrade({
    pick: entryPick,
    regime,
    marketCoins,
    positionSizeUsdt,
  });

  const summaryPrefix =
    entryPick.side === "SHORT" ? `opened-short:${sym}` : `opened:${sym}`;

  if (entryPick.side === "SHORT") {
    console.log(
      `[REGIME: ACTIVE_SHORT] ${sym} ${entryPick.reason} size=$${positionSizeUsdt} entry=${trade.entryPrice} sl=${trade.stopLoss}`,
    );
  }

  return withTickMeta(
    {
      account: {
        ...account,
        currentBalance: Math.max(0, account.currentBalance - positionSizeUsdt),
        openPositions: [...account.openPositions, trade],
      },
      changed: true,
      summary: `${summaryPrefix}:${entryPick.reason}`,
    },
    { entryExecuted: true, pyramided: pyramided || undefined },
  );
}
