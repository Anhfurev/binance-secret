import type { CoinData, DemoAccount, DemoTrade } from "@/lib/types";
import {
  formatNavUsd,
  formatPct4,
  formatSignedNavUsd,
} from "@/lib/trading/paper-scalp-metrics-format";
import { resolvePaperLiveMarkPrice } from "@/lib/trading/paper-scalp-mark-price";

export type PaperWorkspaceNav = {
  available_usdt: number;
  open_positions_usdt: number;
  portfolio_nav_usdt: number;
  starting_usdt: number;
  /** Wallet session: live NAV − persisted starting balance. */
  session_pnl_usdt: number;
  session_pnl_pct: number;
  /** Open legs: Σ (mark − entry) × qty — anchored to DB entry price. */
  open_unrealized_pnl_usdt: number;
};

function unrealizedLegPnl(
  trade: DemoTrade,
  mark: number,
): number {
  if (trade.type === "buy") {
    return (mark - trade.entryPrice) * trade.amount;
  }
  return (trade.entryPrice - mark) * trade.amount;
}

/** Live NAV = free cash + Σ(tokens × live mark). Never cost basis. */
export function computePaperWorkspaceNav(
  account: DemoAccount,
  marketCoins: CoinData[] = [],
): PaperWorkspaceNav {
  const available_usdt = Number(Math.max(0, account.currentBalance).toFixed(4));
  const starting_usdt = Number(
    Math.max(0, account.startingBalance || available_usdt).toFixed(4),
  );

  let open_positions_usdt = 0;
  let open_unrealized_pnl_usdt = 0;

  for (const pos of account.openPositions) {
    const mark = resolvePaperLiveMarkPrice(
      pos.symbol,
      marketCoins,
      pos.entryPrice,
    );
    open_positions_usdt += pos.amount * mark;
    open_unrealized_pnl_usdt += unrealizedLegPnl(pos, mark);
  }

  open_positions_usdt = Number(open_positions_usdt.toFixed(4));
  open_unrealized_pnl_usdt = Number(open_unrealized_pnl_usdt.toFixed(4));

  const portfolio_nav_usdt = Number(
    (available_usdt + open_positions_usdt).toFixed(4),
  );
  const session_pnl_usdt = Number(
    (portfolio_nav_usdt - starting_usdt).toFixed(4),
  );
  const session_pnl_pct =
    starting_usdt > 0
      ? Number(((session_pnl_usdt / starting_usdt) * 100).toFixed(4))
      : 0;

  return {
    available_usdt,
    open_positions_usdt,
    portfolio_nav_usdt,
    starting_usdt,
    session_pnl_usdt,
    session_pnl_pct,
    open_unrealized_pnl_usdt,
  };
}

export function formatNavTelegramBlock(
  nav: PaperWorkspaceNav,
  openLegCount = 0,
): string {
  return [
    `• Free cash (USDT): $${formatNavUsd(nav.available_usdt)}`,
    nav.open_positions_usdt > 0
      ? `• Open legs (${openLegCount}): $${formatNavUsd(nav.open_positions_usdt)} at live mark`
      : openLegCount > 0
        ? `• Open legs: ${openLegCount}`
        : null,
    `• Live NAV: $${formatNavUsd(nav.portfolio_nav_usdt)} USDT`,
    openLegCount > 0
      ? `• Open P&L (vs entry): ${formatSignedNavUsd(nav.open_unrealized_pnl_usdt)}`
      : null,
    `• Session P&L: ${formatSignedNavUsd(nav.session_pnl_usdt)} (${formatPct4(nav.session_pnl_pct)}) vs $${formatNavUsd(nav.starting_usdt)} start`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatNavLogLine(nav: PaperWorkspaceNav): string {
  return `NAV=$${formatNavUsd(nav.portfolio_nav_usdt)} session=${formatSignedNavUsd(nav.session_pnl_usdt)} open=${formatSignedNavUsd(nav.open_unrealized_pnl_usdt)}`;
}

export function humanPaperScalpReason(summary: string): string {
  const fixed: Record<string, string> = {
    "circuit-breaker":
      "Daily loss limit hit — circuit breaker blocks new entries",
    "no-signal":
      "No momentum entry — neither trend resumption nor oversold bounce",
    "no-ema-bullish-cross":
      "No momentum entry on watched symbols (legacy)",
    "rsi-overbought":
      "RSI above overbought threshold — skip chasing extended move",
    "holding-position": "Managing open 15m position (ATR stop / TP / EMA exit)",
    "insufficient-balance":
      "Free USDT too low for configured risk slot",
    "insufficient-free-margin-floor":
      "Free cash below compounding slot size for this NAV tier",
    "max-open-positions":
      "Legacy cap — copy-profile max open positions reached",
    "max-open-positions-reached":
      "Max concurrent open positions reached (workspace limit)",
    "correlation-max-exposure":
      "Correlation filter — max 2 open legs per workspace",
    "btc-bearish-pause":
      "BTC bearish — altcoin entries paused (legacy)",
    "alpha-risk-off":
      "Alpha Shield risk-off — BTC below VWAP or weak trend; entries blocked",
    "atr-trailing-stop":
      "ATR trailing floor hit — locked intraday gains at ratcheted stop",
    "pyramid-layer-added":
      "Pyramid scale-in — added 50% layer on risk-free winner",
    "velocity-tp-70":
      "Velocity 70% take-profit banked — runner at breakeven trails",
    "no-1m-snapshots":
      "15m indicator snapshots missing (klines blocked or empty)",
    "no-hourly-snapshots":
      "15m indicator snapshots missing (klines blocked or empty)",
  };
  if (fixed[summary]) return fixed[summary];
  if (summary.startsWith("velocity-tp-70:")) {
    const sym = summary.replace("velocity-tp-70:", "");
    return `Velocity 70% take-profit banked on ${sym} — runner trails at breakeven`;
  }
  if (summary.startsWith("opened:")) {
    return `BUY filled — ${summary.replace("opened:", "").replace(/:/g, " ")}`;
  }
  if (summary.startsWith("closed:")) {
    return `SELL / exit — ${summary.replace("closed:", "").replace(/:/g, " ")}`;
  }
  return summary;
}
