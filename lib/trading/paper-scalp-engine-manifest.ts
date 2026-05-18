import type { DemoAccount, DemoTrade } from "@/lib/types";
import type { Scalp1mSnapshot } from "@/lib/trading/paper-scalp-indicators";
import {
  isAltcoinSymbol,
  isBtcBearish1h,
  MAX_OPEN_LEGS_PER_WORKSPACE,
  passesCorrelationExposureGate,
} from "@/lib/trading/paper-scalp-correlation";
import { normalizePaperSymbol } from "@/lib/trading/paper-scalp-mark-price";
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
    btcBearish: boolean;
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

  if (ctx.btcBearish && isAltcoinSymbol(norm(symbol))) {
    return tgBullet(`${base} | BTC Regime [BLOCKED]`);
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

function formatActiveLegHtml(trade: DemoTrade): string {
  const sym = escapeTelegramHtml(norm(trade.symbol));
  return tgBullet(
    `${sym} LONG — entry ${escapeTelegramHtml(formatAssetPrice(trade.entryPrice))} · SL ${escapeTelegramHtml(formatAssetPrice(trade.stopLoss))} · TP ${escapeTelegramHtml(formatAssetPrice(trade.takeProfit))} · $${escapeTelegramHtml(formatNavUsd(trade.value))}`,
  );
}

function buildGatesBlockHtml(
  btcBearish: boolean,
  openLegCount: number,
  masterSummary: string,
): string[] {
  const lines: string[] = [tgSection("[GATES & FILTERS]")];

  if (btcBearish) {
    lines.push(
      `🛑 ${tgBold("BTC REGIME GATE: TRUE")} (EMA9 &lt; EMA21) · All Altcoin entries are currently blocked.`,
    );
  } else {
    lines.push("✅ BTC REGIME GATE: FALSE · Altcoin entries allowed.");
  }

  const atCap = !passesCorrelationExposureGate(openLegCount);
  lines.push(
    atCap
      ? `🛑 ${tgBold("CORRELATION CAP:")} ${openLegCount}/${MAX_OPEN_LEGS_PER_WORKSPACE} legs — new entries blocked.`
      : `✅ ${tgBold("CORRELATION CAP:")} ${openLegCount}/${MAX_OPEN_LEGS_PER_WORKSPACE} legs — slot(s) available.`,
  );

  if (masterSummary === "circuit-breaker") {
    lines.push(`🛑 ${tgBold("CIRCUIT BREAKER:")} tripped — new entries blocked.`);
  }
  if (masterSummary === "btc-bearish-pause") {
    lines.push(`🛑 ${tgBold("TICK OUTCOME:")} BTC bearish pause (no alt entries this cycle).`);
  }
  if (masterSummary === "correlation-max-exposure") {
    lines.push(`🛑 ${tgBold("TICK OUTCOME:")} max correlated exposure reached.`);
  }

  return lines;
}

export function buildUnifiedEngineManifest(input: EngineManifestInput): string {
  const btcBearish =
    input.btcRegimeActive ?? isBtcBearish1h(input.scalpSnapshots);
  const account = input.masterAccount;
  const openLegCount = account?.openPositions.length ?? 0;
  const held = new Set(
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

  lines.push("", tgSection("[ACTIVE LEGS]"));
  if (account && account.openPositions.length > 0) {
    for (const leg of account.openPositions) {
      lines.push(formatActiveLegHtml(leg));
    }
  } else {
    lines.push(tgBullet("None — flat or cash-only."));
  }

  lines.push("", ...buildGatesBlockHtml(btcBearish, openLegCount, input.masterSummary));

  lines.push("", tgSection("[MARKET SCAN]"));
  for (const s of input.symbols) {
    lines.push(
      buildSymbolGridRow(s, input.scalpSnapshots.get(norm(s)), input.momentum, {
        held,
        btcBearish,
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

export function compileUnifiedEngineManifest(input: EngineManifestInput): string {
  console.log("[paper-scalp-manifest] dispatch start");
  const text = buildUnifiedEngineManifest(input);
  console.log("[paper-scalp-manifest] dashboard compiled (HTML)");
  console.log(`[paper-scalp-manifest]\n${text}`);
  return text;
}

let pendingManifestTelegram: Promise<void> | null = null;

async function shipManifestTelegramDetached(html: string): Promise<void> {
  await transmitManifestHtmlDashboard(html);
  console.log("[paper-scalp-manifest] telegram dispatch settled");
}

export function flushPendingManifestTelegram(): Promise<void> {
  return pendingManifestTelegram ?? Promise.resolve();
}

export function scheduleUnifiedEngineManifestDispatch(
  input: EngineManifestInput,
): string {
  const text = compileUnifiedEngineManifest(input);
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
