import type { CoinData, DemoAccount, DemoTrade } from "@/lib/types";
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
import {
  formatNavTelegramBlock,
  humanPaperScalpReason,
  type PaperWorkspaceNav,
} from "@/lib/trading/paper-scalp-nav";
import { sendTelegramNotificationAsync } from "@/lib/trading/paper-scalp-telegram";

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
  /** Explicit BTC gate telemetry (defaults to snapshot EMA check). */
  btcRegimeActive?: boolean;
};

type SymbolGridRow = {
  symbol: string;
  line: string;
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
): SymbolGridRow {
  const sym = norm(symbol);
  if (!snap) {
    return { symbol: sym, line: `• ${sym}: — | No Snapshot [BLOCKED]` };
  }

  const rsi = snap.rsi14.toFixed(1);
  const base = `• ${sym}: RSI ${rsi}`;

  if (ctx.held.has(sym)) {
    return { symbol: sym, line: `${base} | Open Leg [HELD]` };
  }

  const evaluation = evaluatePaperBuySignal(snap, momentum);

  if (ctx.btcBearish && isAltcoinSymbol(sym)) {
    return { symbol: sym, line: `${base} | BTC Regime [BLOCKED]` };
  }

  if (ctx.atMaxLegs && evaluation.shouldBuy) {
    return { symbol: sym, line: `${base} | Max Risk Cap Hit [BLOCKED]` };
  }

  if (evaluation.reason === "rsi_overbought") {
    return { symbol: sym, line: `${base} | RSI High [BLOCKED]` };
  }

  if (evaluation.shouldBuy) {
    const tag =
      evaluation.reason === "oversold_bounce"
        ? "Oversold Bounce"
        : "Trend Resumption";
    return { symbol: sym, line: `${base} | ${tag} [SIGNAL]` };
  }

  return { symbol: sym, line: `${base} | No Signal [PASSED]` };
}

function formatActiveLeg(trade: DemoTrade): string {
  const sym = norm(trade.symbol);
  return [
    `• ${sym} LONG`,
    `  entry ${formatAssetPrice(trade.entryPrice)}`,
    `· SL ${formatAssetPrice(trade.stopLoss)}`,
    `· TP ${formatAssetPrice(trade.takeProfit)}`,
    `· $${formatNavUsd(trade.value)}`,
  ].join(" ");
}

function buildGatesBlock(
  btcBearish: boolean,
  openLegCount: number,
  masterSummary: string,
): string[] {
  const lines: string[] = ["*[GATES & FILTERS]*"];

  if (btcBearish) {
    lines.push(
      "🛑 *BTC REGIME GATE: TRUE* (EMA9 < EMA21) · All Altcoin entries are currently blocked.",
    );
  } else {
    lines.push("✅ BTC REGIME GATE: FALSE · Altcoin entries allowed.");
  }

  const atCap = !passesCorrelationExposureGate(openLegCount);
  lines.push(
    atCap
      ? `🛑 *CORRELATION CAP:* ${openLegCount}/${MAX_OPEN_LEGS_PER_WORKSPACE} legs — new entries blocked.`
      : `✅ *CORRELATION CAP:* ${openLegCount}/${MAX_OPEN_LEGS_PER_WORKSPACE} legs — slot(s) available.`,
  );

  if (masterSummary === "circuit-breaker") {
    lines.push("🛑 *CIRCUIT BREAKER:* tripped — new entries blocked.");
  }
  if (masterSummary === "btc-bearish-pause") {
    lines.push("🛑 *TICK OUTCOME:* BTC bearish pause (no alt entries this cycle).");
  }
  if (masterSummary === "correlation-max-exposure") {
    lines.push("🛑 *TICK OUTCOME:* max correlated exposure reached.");
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
    "📋 *UNIFIED ENGINE MANIFEST*",
    `🕐 ${input.ranAt} · ${input.durationMs.toFixed(0)}ms · ${input.partial ? "PARTIAL" : "OK"}`,
    `• Snapshots: ${input.snapshotsLoaded}/${input.symbols.length} (${input.snapshotSource}) · marks: ${input.marketSource}`,
  ];

  lines.push("", "*[PORTFOLIO NAV]*");
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
    lines.push(formatNavTelegramBlock(nav, openLegCount));
    if (input.masterWorkspaceKey) {
      lines.push(`• Master workspace: \`${input.masterWorkspaceKey}\``);
    }
  } else {
    lines.push("• No master workspace tick this cycle.");
  }

  lines.push("", "*[ACTIVE LEGS]*");
  if (account && account.openPositions.length > 0) {
    for (const leg of account.openPositions) {
      lines.push(formatActiveLeg(leg));
    }
  } else {
    lines.push("• None — flat or cash-only.");
  }

  lines.push("", ...buildGatesBlock(btcBearish, openLegCount, input.masterSummary));

  lines.push("", "*[MARKET SCAN]*");
  const grid = input.symbols.map((s) =>
    buildSymbolGridRow(s, input.scalpSnapshots.get(norm(s)), input.momentum, {
      held,
      btcBearish,
      atMaxLegs,
    }),
  );
  for (const row of grid) {
    lines.push(row.line);
  }

  lines.push("", "*[WORKSPACE HEALTH]*");
  if (input.workspaceRows.length === 0) {
    lines.push("• No demo workspaces processed.");
  } else {
    for (const row of input.workspaceRows) {
      const tag = row.workspaceKey === input.masterWorkspaceKey ? " ★" : "";
      lines.push(
        `• \`${row.workspaceKey}\`${tag}: ${row.action} · ${humanPaperScalpReason(row.summary)} · NAV $${formatNavUsd(row.nav.portfolio_nav_usdt)}`,
      );
    }
  }

  if (input.partial && input.partialReason) {
    lines.push(`• ⚠️ Partial run: ${input.partialReason}`);
  }

  lines.push("", "*[EXECUTION]*");
  lines.push(
    `• Scanned ${input.scanned} · persisted ${input.updated} · async queue ${input.persistQueued}`,
  );
  if (input.actions.length > 0) {
    lines.push(`• Actions: ${input.actions.slice(0, 8).join(" | ")}`);
  } else {
    lines.push(`• Tick summary: \`${input.masterSummary}\``);
  }

  return lines.join("\n").slice(0, 4090);
}

/** Sync compile + PM2 log — safe on the HTTP hot path. */
export function compileUnifiedEngineManifest(input: EngineManifestInput): string {
  console.log("[paper-scalp-manifest] dispatch start");
  const text = buildUnifiedEngineManifest(input);
  console.log("[paper-scalp-manifest] dashboard compiled");
  console.log(`[paper-scalp-manifest]\n${text}`);
  return text;
}

let pendingManifestTelegram: Promise<void> | null = null;

function shipManifestTelegramDetached(text: string): Promise<void> {
  return sendTelegramNotificationAsync(text)
    .then(() => {
      console.log("[paper-scalp-manifest] telegram dispatch settled");
    })
    .catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("[paper-scalp-manifest] telegram failed:", err.message);
    });
}

/** Next.js `after()` — drain Telegram without blocking res.json. */
export function flushPendingManifestTelegram(): Promise<void> {
  return pendingManifestTelegram ?? Promise.resolve();
}

/**
 * Compile on hot path; Telegram ships on nextTick (does not block res.json).
 * Always runs — never skips on HOLD/BLOCKED.
 */
export function scheduleUnifiedEngineManifestDispatch(
  input: EngineManifestInput,
): string {
  const text = compileUnifiedEngineManifest(input);
  pendingManifestTelegram = new Promise<void>((resolve) => {
    process.nextTick(() => {
      void shipManifestTelegramDetached(text).finally(resolve);
    });
  });
  return text;
}

/** Blocking send — tests / manual tooling only. */
export async function dispatchUnifiedEngineManifest(
  input: EngineManifestInput,
): Promise<void> {
  const text = compileUnifiedEngineManifest(input);
  await sendTelegramNotificationAsync(text);
  console.log("[paper-scalp-manifest] telegram dispatch settled");
}
