import type { DemoAccount, DemoTrade } from "@/lib/types";
import type { Scalp1mSnapshot, ScalpCandle } from "@/lib/trading/paper-scalp-indicators";
import {
  isAltcoinSymbol,
  MAX_OPEN_LEGS_PER_WORKSPACE,
  passesCorrelationExposureGate,
} from "@/lib/trading/paper-scalp-correlation";
import {
  buildDeployLeaderboard,
  rankAltcoinMomentum,
} from "@/lib/trading/paper-scalp-momentum-rank";
import {
  calculateDynamicRegime,
  type DynamicMarketRegime,
  resolveBtcCandles,
  resolveBtcSnapshot,
} from "@/lib/trading/paper-scalp-regime";
import { normalizePaperSymbol, resolvePaperLiveMarkPrice } from "@/lib/trading/paper-scalp-mark-price";
import { formatPyramidLegSuffix } from "@/lib/trading/paper-scalp-pyramid";
import {
  formatTrailingLegManifestLine,
  resolveLegAtr14,
} from "@/lib/trading/paper-scalp-trailing-exit";
import type { CoinData } from "@/lib/types";
import {
  formatAssetPrice,
  formatNavUsd,
} from "@/lib/trading/paper-scalp-metrics-format";
import {
  evaluatePaperBuySignal,
  type PaperMomentumSettings,
} from "@/lib/trading/paper-scalp-momentum";
import { humanPaperScalpReason, type PaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import {
  escapeTelegramHtml,
  formatNavHtmlBlock,
  tgBold,
  tgBullet,
  tgCode,
  tgManifestTitle,
  tgSection,
  transmitManifestHtmlDashboard,
} from "@/lib/trading/paper-scalp-telegram-html";

export type WorkspaceTickRow = {
  workspaceKey: string;
  action: string;
  summary: string;
  nav: PaperWorkspaceNav;
  openLegCount: number;
};

export type EngineManifestInput = {
  ranAt: string;
  durationMs: number;
  partial: boolean;
  partialReason?: string;
  snapshotSource: string;
  marketSource: string;
  snapshotsLoaded: number;
  symbols: string[];
  scalpSnapshots: Map<string, Scalp1mSnapshot>;
  candlesBySymbol?: Map<string, ScalpCandle[]>;
  marketCoins?: CoinData[];
  apiDegraded?: boolean;
  momentum: PaperMomentumSettings;
  masterWorkspaceKey: string | null;
  masterAccount: DemoAccount | null;
  masterSummary: string;
  workspaceRows: WorkspaceTickRow[];
  actions: string[];
  scanned: number;
  updated: number;
  persistQueued: number;
  btcRegimeActive?: boolean;
};

function norm(sym: string): string {
  return normalizePaperSymbol(sym);
}

function buildSymbolGridRow(
  symbol: string,
  snap: Scalp1mSnapshot | undefined,
  momentum: PaperMomentumSettings,
  ctx: {
    held: Set<string>;
    regime: DynamicMarketRegime;
    deploySet: Set<string>;
    atMaxLegs: boolean;
  },
): string {
  const sym = escapeTelegramHtml(norm(symbol));
  if (!snap) {
    return tgBullet(`${sym}: — | No Snapshot [BLOCKED]`);
  }

  const rsi = escapeTelegramHtml(snap.rsi14.toFixed(1));
  const base = `${sym}: RSI ${rsi}`;

  if (ctx.held.has(norm(symbol))) {
    return tgBullet(`${base} | Open Leg [HELD]`);
  }

  const evaluation = evaluatePaperBuySignal(snap, momentum);
  const isAlt = isAltcoinSymbol(norm(symbol));

  if (ctx.regime.blockAltcoinEntries && isAlt) {
    return tgBullet(`${base} | Alpha Shield Risk-Off [BLOCKED]`);
  }

  if (isAlt && !ctx.deploySet.has(norm(symbol)) && evaluation.shouldBuy) {
    return tgBullet(`${base} | Momentum Rank [BLOCKED]`);
  }

  if (ctx.atMaxLegs && evaluation.shouldBuy) {
    return tgBullet(`${base} | Max Risk Cap Hit [BLOCKED]`);
  }

  if (evaluation.reason === "rsi_overbought") {
    return tgBullet(`${base} | RSI High [BLOCKED]`);
  }

  if (evaluation.shouldBuy) {
    const tag =
      evaluation.reason === "oversold_bounce"
        ? "Oversold Bounce"
        : "Trend Resumption";
    return tgBullet(`${base} | ${escapeTelegramHtml(tag)} [SIGNAL]`);
  }

  return tgBullet(`${base} | No Signal [PASSED]`);
}

function formatActiveLegHtml(
  trade: DemoTrade,
  ctx: {
    mark: number;
    atr14: number;
  },
): string {
  const sym = escapeTelegramHtml(norm(trade.symbol));
  const trailLine = escapeTelegramHtml(
    formatTrailingLegManifestLine(trade, ctx.mark, ctx.atr14),
  );
  const pyramidLine = escapeTelegramHtml(formatPyramidLegSuffix(trade));
  const velocityTag = trade.velocityTakeProfitSecured
    ? " · [Velocity 70% banked · runner 30%]"
    : "";
  return tgBullet(
    `${sym} LONG — entry ${escapeTelegramHtml(formatAssetPrice(trade.entryPrice))} · $${escapeTelegramHtml(formatNavUsd(trade.value))} · ${trailLine} · ${pyramidLine}${velocityTag}`,
  );
}

function buildGatesBlockHtml(
  regime: DynamicMarketRegime,
  deployLeaders: string[],
  openLegCount: number,
  masterSummary: string,
): string[] {
  const lines: string[] = [tgSection("[ALPHA SHIELD · 15m]")];

  const stateLabel = escapeTelegramHtml(regime.state.toUpperCase());
  const score = escapeTelegramHtml(String(regime.trendScore.score));
  const vwapOk = regime.btcAboveVwap ? "above" : "below";
  const emaOk = regime.btcAboveEma21 ? "above" : "below";

  if (regime.state === "risk_off" || regime.blockAltcoinEntries) {
    lines.push(
      `🛑 ${tgBold(`REGIME: ${stateLabel}`)} · trend ${score} · BTC ${emaOk} EMA21 · ${vwapOk} session VWAP · alt entries blocked.`,
    );
  } else if (regime.state === "neutral") {
    lines.push(
      `⚠️ ${tgBold(`REGIME: ${stateLabel}`)} · trend ${score} · 50% size · top ${regime.deployTopN} momentum only.`,
    );
  } else {
    lines.push(
      `✅ ${tgBold(`REGIME: ${stateLabel}`)} · trend ${score} · full size · deploy top ${regime.deployTopN}.`,
    );
  }

  if (deployLeaders.length > 0) {
    lines.push(
      tgBullet(
        `Momentum leaders: ${escapeTelegramHtml(deployLeaders.join(", "))}`,
      ),
    );
  }

  const atCap = !passesCorrelationExposureGate(openLegCount);
  lines.push(
    atCap
      ? `🛑 ${tgBold("POSITION CAP:")} ${openLegCount}/${MAX_OPEN_LEGS_PER_WORKSPACE} legs — new entries blocked.`
      : `✅ ${tgBold("POSITION CAP:")} ${openLegCount}/${MAX_OPEN_LEGS_PER_WORKSPACE} legs — slot(s) available.`,
  );

  if (masterSummary === "circuit-breaker") {
    lines.push(`🛑 ${tgBold("CIRCUIT BREAKER:")} tripped — new entries blocked.`);
  }
  if (masterSummary === "alpha-risk-off") {
    lines.push(`🛑 ${tgBold("TICK OUTCOME:")} Alpha Shield risk-off (no alt entries).`);
  }
  if (masterSummary === "correlation-max-exposure") {
    lines.push(`🛑 ${tgBold("TICK OUTCOME:")} max open legs reached.`);
  }

  return lines;
}

export function buildUnifiedEngineManifest(input: EngineManifestInput): string {
  const candles = input.candlesBySymbol ?? new Map<string, ScalpCandle[]>();
  const regime = calculateDynamicRegime({
    btcSnapshot: resolveBtcSnapshot(input.scalpSnapshots),
    btcCandles: resolveBtcCandles(candles),
    apiDegraded: input.apiDegraded ?? input.btcRegimeActive,
  });
  const watch = input.symbols.filter((s) => isAltcoinSymbol(norm(s)));
  const held = new Set(
    (input.masterAccount?.openPositions ?? []).map((p) => norm(p.symbol)),
  );
  const momentumRanked = rankAltcoinMomentum({
    symbols: watch,
    snapshots: input.scalpSnapshots,
    candlesBySymbol: candles,
    regime,
    held,
  });
  const leaders = buildDeployLeaderboard(momentumRanked, regime.deployTopN);
  const deploySet = new Set(leaders.map((row) => row.symbol));
  const deployLeaderLabels = leaders.map(
    (row) => `${row.symbol}(${row.score.toFixed(0)})`,
  );

  const account = input.masterAccount;
  const openLegCount = account?.openPositions.length ?? 0;
  const heldSymbols = new Set(
    (account?.openPositions ?? []).map((p) => norm(p.symbol)),
  );
  const atMaxLegs = !passesCorrelationExposureGate(openLegCount);

  const lines: string[] = [
    tgManifestTitle("📋 UNIFIED ENGINE MANIFEST"),
    tgBullet(
      `${escapeTelegramHtml(input.ranAt)} · ${escapeTelegramHtml(String(input.durationMs.toFixed(0)))}ms · ${input.partial ? "PARTIAL" : "OK"}`,
    ),
    tgBullet(
      `Snapshots: ${input.snapshotsLoaded}/${input.symbols.length} (${escapeTelegramHtml(input.snapshotSource)}) · marks: ${escapeTelegramHtml(input.marketSource)}`,
    ),
    "",
    tgSection("[PORTFOLIO NAV]"),
  ];

  if (account) {
    const masterRow = input.workspaceRows.find(
      (r) => r.workspaceKey === input.masterWorkspaceKey,
    );
    const nav = masterRow?.nav ?? {
      available_usdt: account.currentBalance,
      open_positions_usdt: 0,
      portfolio_nav_usdt: account.currentBalance,
      starting_usdt: account.startingBalance,
      session_pnl_usdt: 0,
      session_pnl_pct: 0,
      open_unrealized_pnl_usdt: 0,
    };
    lines.push(formatNavHtmlBlock(nav, openLegCount));
    if (input.masterWorkspaceKey) {
      lines.push(tgBullet(`Master workspace: ${tgCode(input.masterWorkspaceKey)}`));
    }
  } else {
    lines.push(tgBullet("No master workspace tick this cycle."));
  }

  lines.push("", tgSection("[ACTIVE LEGS · ATR TRAIL]"));
  if (account && account.openPositions.length > 0) {
    const marks = input.marketCoins ?? [];
    for (const leg of account.openPositions) {
      const sym = norm(leg.symbol);
      const snap = input.scalpSnapshots.get(sym);
      const mark = resolvePaperLiveMarkPrice(
        sym,
        marks,
        snap?.close ?? leg.entryPrice,
      );
      const atr14 = resolveLegAtr14(snap, leg);
      lines.push(formatActiveLegHtml(leg, { mark, atr14 }));
    }
  } else {
    lines.push(tgBullet("None — flat or cash-only."));
  }

  lines.push(
    "",
    ...buildGatesBlockHtml(
      regime,
      deployLeaderLabels,
      openLegCount,
      input.masterSummary,
    ),
  );

  lines.push("", tgSection("[MARKET SCAN · 15m]"));
  for (const s of input.symbols) {
    lines.push(
      buildSymbolGridRow(s, input.scalpSnapshots.get(norm(s)), input.momentum, {
        held: heldSymbols,
        regime,
        deploySet,
        atMaxLegs,
      }),
    );
  }

  lines.push("", tgSection("[WORKSPACE HEALTH]"));
  if (input.workspaceRows.length === 0) {
    lines.push(tgBullet("No demo workspaces processed."));
  } else {
    for (const row of input.workspaceRows) {
      const star = row.workspaceKey === input.masterWorkspaceKey ? " ★" : "";
      lines.push(
        tgBullet(
          `${tgCode(row.workspaceKey)}${star}: ${escapeTelegramHtml(row.action)} · ${escapeTelegramHtml(humanPaperScalpReason(row.summary))} · NAV $${escapeTelegramHtml(formatNavUsd(row.nav.portfolio_nav_usdt))}`,
        ),
      );
    }
  }

  if (input.partial && input.partialReason) {
    lines.push(
      tgBullet(`⚠️ Partial run: ${escapeTelegramHtml(input.partialReason)}`),
    );
  }

  lines.push("", tgSection("[EXECUTION]"));
  lines.push(
    tgBullet(
      `Scanned ${input.scanned} · persisted ${input.updated} · async queue ${input.persistQueued}`,
    ),
  );
  if (input.actions.length > 0) {
    lines.push(
      tgBullet(`Actions: ${escapeTelegramHtml(input.actions.slice(0, 8).join(" | "))}`),
    );
  } else {
    lines.push(tgBullet(`Tick summary: ${tgCode(input.masterSummary)}`));
  }

  return lines.join("\n").slice(0, 4090);
}

export function compileUnifiedEngineManifest(
  input: EngineManifestInput,
  options?: { verboseLog?: boolean },
): string {
  const text = buildUnifiedEngineManifest(input);
  if (options?.verboseLog) {
    console.log("[paper-scalp-manifest] dispatch start");
    console.log(`[paper-scalp-manifest]\n${text}`);
  }
  return text;
}

let pendingManifestTelegram: Promise<void> | null = null;

async function shipManifestTelegramDetached(html: string): Promise<void> {
  await transmitManifestHtmlDashboard(html);
}

export function flushPendingManifestTelegram(): Promise<void> {
  return pendingManifestTelegram ?? Promise.resolve();
}

export function scheduleUnifiedEngineManifestDispatch(
  input: EngineManifestInput,
  options?: { verboseLog?: boolean },
): string {
  const text = compileUnifiedEngineManifest(input, options);
  pendingManifestTelegram = new Promise<void>((resolve, reject) => {
    process.nextTick(() => {
      void shipManifestTelegramDetached(text).then(resolve).catch(reject);
    });
  });
  return text;
}

export async function dispatchUnifiedEngineManifest(
  input: EngineManifestInput,
): Promise<void> {
  const html = compileUnifiedEngineManifest(input);
  await shipManifestTelegramDetached(html);
}
