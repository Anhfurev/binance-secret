import { mockCoins } from "@/lib/mock-data";
import { percentOf, recalculateAccountMetrics } from "@/lib/demo-account";
import { defaultScalpingSettings } from "@/lib/trading/settings";
import { evaluateScalpingTrade } from "@/lib/trading/strategyEngine";
import { createDemoTradeFromExecution } from "@/lib/trading/tradeExecutor";
import type {
  AITradeSignal,
  CoinData,
  DemoAccount,
  DemoTrade,
} from "@/lib/types";

type AutoPilotMode = "signals" | "dca";
type CopyProfile = "conservative" | "balanced" | "aggressive";

function getCopyProfileConfig(copyProfile: CopyProfile) {
  if (copyProfile === "conservative") {
    return {
      allocationCapPct: 0.025,
      maxOpenPositions: 3,
    };
  }

  if (copyProfile === "aggressive") {
    return {
      allocationCapPct: 0.05,
      maxOpenPositions: 8,
    };
  }

  return {
    allocationCapPct: 0.035,
    maxOpenPositions: 5,
  };
}

function getLivePriceForSymbol(
  symbol: string,
  marketCoins: CoinData[],
  fallback: number,
) {
  const normalized = symbol.replace(/USDT$/i, "").toLowerCase();
  const coin = marketCoins.find((item) => item.symbol === normalized);
  return coin?.current_price ?? fallback;
}

function makeSpotTradeFromSignal(
  signal: AITradeSignal,
  tradeValue: number,
  marketCoins: CoinData[],
): DemoTrade {
  const liveEntry = getLivePriceForSymbol(
    signal.symbol,
    marketCoins,
    signal.entryPrice,
  );
  const amount = tradeValue / liveEntry;

  return {
    id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    signalId: signal.id,
    coinId: signal.coinId,
    symbol: signal.symbol,
    type: signal.signalType.includes("SELL") ? "sell" : "buy",
    entryPrice: liveEntry,
    amount: Number(amount.toFixed(6)),
    value: Number(tradeValue.toFixed(2)),
    status: "open",
    openedAt: new Date(),
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfits[0]?.price ?? liveEntry * 1.05,
    followedSignal: true,
  };
}

export interface PaperAutomationTickResult {
  account: DemoAccount;
  changed: boolean;
  summary: string;
}

export function runPaperTradingAutomationTick(params: {
  account: DemoAccount;
  signals: AITradeSignal[];
  marketCoins?: CoinData[];
  autoPilotMode: AutoPilotMode;
  copyProfile: CopyProfile;
}): PaperAutomationTickResult {
  const { account, signals, autoPilotMode, copyProfile } = params;
  const marketCoins = params.marketCoins?.length
    ? params.marketCoins
    : mockCoins;
  const copyProfileConfig = getCopyProfileConfig(copyProfile);

  if (account.circuitBreakerTripped) {
    return { account, changed: false, summary: "circuit-breaker" };
  }

  const executableSignals = signals.filter(
    (signal) =>
      signal.isActive !== false &&
      (signal.signalType === "BUY" ||
        signal.signalType === "STRONG_BUY" ||
        signal.signalType === "SELL" ||
        signal.signalType === "STRONG_SELL"),
  );

  const exitCandidate = account.openPositions.find((trade) => {
    const livePrice = getLivePriceForSymbol(
      trade.symbol,
      marketCoins,
      trade.entryPrice,
    );
    const isLong = trade.isFutures
      ? trade.direction === "LONG"
      : trade.type === "buy";
    const trailingStop = trade.trailingStopPct
      ? isLong
        ? Math.max(
            trade.stopLoss,
            livePrice > trade.entryPrice
              ? livePrice * (1 - trade.trailingStopPct / 100)
              : trade.stopLoss,
          )
        : Math.min(
            trade.stopLoss,
            livePrice < trade.entryPrice
              ? livePrice * (1 + trade.trailingStopPct / 100)
              : trade.stopLoss,
          )
      : trade.stopLoss;

    const stopTriggered = isLong
      ? livePrice <= trailingStop
      : livePrice >= trailingStop;
    const takeTriggered = isLong
      ? livePrice >= trade.takeProfit
      : livePrice <= trade.takeProfit;
    const timedOut =
      Date.now() - new Date(trade.openedAt).getTime() >= 20 * 60 * 1000;

    return stopTriggered || takeTriggered || timedOut;
  });

  if (exitCandidate) {
    const liveClose = getLivePriceForSymbol(
      exitCandidate.symbol,
      marketCoins,
      exitCandidate.entryPrice,
    );
    const closeSlippage =
      1 +
      (Math.random() * 0.0025 - 0.00125) *
        (exitCandidate.type === "sell" ? -1 : 1);
    const closePrice = liveClose * closeSlippage;

    let rawPnl: number;
    if (exitCandidate.isFutures && exitCandidate.direction) {
      const multiplier = exitCandidate.direction === "LONG" ? 1 : -1;
      rawPnl =
        (closePrice - exitCandidate.entryPrice) *
        exitCandidate.amount *
        multiplier;
    } else {
      rawPnl =
        exitCandidate.type === "buy"
          ? (closePrice - exitCandidate.entryPrice) * exitCandidate.amount
          : (exitCandidate.entryPrice - closePrice) * exitCandidate.amount;
    }

    const pnl = Number(rawPnl.toFixed(2));
    const effectiveValue = exitCandidate.isFutures
      ? (exitCandidate.marginUsed ?? exitCandidate.value)
      : exitCandidate.value;
    const pnlPercent = Number(((pnl / effectiveValue) * 100).toFixed(2));
    const newDailyPnl = (account.dailyPnl ?? 0) + pnl;
    const hitCB =
      newDailyPnl < 0 &&
      percentOf(Math.abs(newDailyPnl), account.startingBalance) >=
        defaultScalpingSettings.maxDailyLossPct;

    const closedTrade: DemoTrade = {
      ...exitCandidate,
      status: pnl >= 0 ? "closed" : "stopped",
      exitPrice: Number(closePrice.toFixed(closePrice >= 1 ? 2 : 4)),
      pnl,
      pnlPercent,
      closedAt: new Date(),
    };

    const newEquity = account.currentBalance + effectiveValue + pnl;

    return {
      account: recalculateAccountMetrics({
        ...account,
        currentBalance: newEquity,
        dailyPnl: newDailyPnl,
        circuitBreakerTripped: hitCB,
        equityCurve: [
          ...(account.equityCurve ?? []),
          { time: new Date().toISOString(), equity: newEquity },
        ],
        openPositions: account.openPositions.filter(
          (item) => item.id !== exitCandidate.id,
        ),
        tradeHistory: [closedTrade, ...account.tradeHistory],
      }),
      changed: true,
      summary: `closed:${exitCandidate.symbol}`,
    };
  }

  if (account.openPositions.length >= copyProfileConfig.maxOpenPositions) {
    return { account, changed: false, summary: "max-open-positions" };
  }

  const existingSignalIds = new Set(
    account.openPositions.map((trade) => trade.signalId),
  );

  if (autoPilotMode === "dca") {
    const target = executableSignals
      .filter((signal) => signal.signalType.includes("BUY"))
      .filter((signal) => !existingSignalIds.has(signal.id))
      .sort((left, right) => right.confidence - left.confidence)[0];

    if (!target) {
      return { account, changed: false, summary: "no-dca-candidate" };
    }

    const dcaNotional = Math.max(
      50,
      account.currentBalance * copyProfileConfig.allocationCapPct * 0.6,
    );
    const dcaTrade = makeSpotTradeFromSignal(target, dcaNotional, marketCoins);
    dcaTrade.notes = "Auto DCA buy";
    dcaTrade.tags = ["auto", "dca", target.symbol];

    return {
      account: {
        ...account,
        currentBalance: Math.max(0, account.currentBalance - dcaNotional),
        openPositions: [dcaTrade, ...account.openPositions].slice(
          0,
          copyProfileConfig.maxOpenPositions,
        ),
      },
      changed: true,
      summary: `opened-dca:${target.symbol}`,
    };
  }

  const rankedCandidates = executableSignals
    .filter((signal) => !existingSignalIds.has(signal.id))
    .map((signal) => {
      const coin = marketCoins.find(
        (item) => item.symbol.toUpperCase() === signal.symbol.toUpperCase(),
      );
      const decision = evaluateScalpingTrade({
        signal,
        coin,
        account,
        settings: defaultScalpingSettings,
        preferredAllocationPct: copyProfileConfig.allocationCapPct,
      });

      return { signal, decision };
    })
    .filter((item) => item.decision.status === "execute")
    .sort((left, right) => right.decision.score - left.decision.score);

  const bestCandidate = rankedCandidates[0];
  if (!bestCandidate?.decision.execution || !bestCandidate.decision.risk) {
    return { account, changed: false, summary: "no-signal-execution" };
  }

  const newTrade = createDemoTradeFromExecution({
    signal: bestCandidate.signal,
    followedSignal: true,
    execution: bestCandidate.decision.execution,
    riskPlan: bestCandidate.decision.risk,
    decisionScore: bestCandidate.decision.score,
    reasons: bestCandidate.decision.reasons,
  });

  const tradeCapital = newTrade.isFutures
    ? (newTrade.marginUsed ?? newTrade.value)
    : newTrade.value;

  return {
    account: {
      ...account,
      currentBalance: Math.max(0, account.currentBalance - tradeCapital),
      openPositions: [newTrade, ...account.openPositions].slice(
        0,
        copyProfileConfig.maxOpenPositions,
      ),
    },
    changed: true,
    summary: `opened:${newTrade.symbol}`,
  };
}
