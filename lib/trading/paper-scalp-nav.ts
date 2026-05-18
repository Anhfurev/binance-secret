import type { CoinData, DemoAccount } from "@/lib/types";

export type PaperWorkspaceNav = {
  available_usdt: number;
  open_positions_usdt: number;
  portfolio_nav_usdt: number;
  starting_usdt: number;
  session_pnl_usdt: number;
  session_pnl_pct: number;
};

export function computePaperWorkspaceNav(
  account: DemoAccount,
  marketCoins: CoinData[] = [],
): PaperWorkspaceNav {
  const available_usdt = Number(
    Math.max(0, account.currentBalance).toFixed(2),
  );
  const starting_usdt = Number(
    Math.max(0, account.startingBalance || available_usdt).toFixed(2),
  );

  let open_positions_usdt = 0;
  for (const pos of account.openPositions) {
    const sym = pos.symbol.toUpperCase().replace(/\//g, "");
    const base = sym.replace(/USDT$/, "").toLowerCase();
    const coin = marketCoins.find((c) => c.symbol.toLowerCase() === base);
    const mark = coin?.current_price ?? pos.entryPrice;
    open_positions_usdt += pos.amount * mark;
  }
  open_positions_usdt = Number(open_positions_usdt.toFixed(2));

  const portfolio_nav_usdt = Number(
    (available_usdt + open_positions_usdt).toFixed(2),
  );
  const session_pnl_usdt = Number((portfolio_nav_usdt - starting_usdt).toFixed(2));
  const session_pnl_pct =
    starting_usdt > 0
      ? Number(((session_pnl_usdt / starting_usdt) * 100).toFixed(2))
      : 0;

  return {
    available_usdt,
    open_positions_usdt,
    portfolio_nav_usdt,
    starting_usdt,
    session_pnl_usdt,
    session_pnl_pct,
  };
}

export function formatNavTelegramBlock(
  nav: PaperWorkspaceNav,
  openLegCount = 0,
): string {
  const pnlSign = nav.session_pnl_usdt >= 0 ? "+" : "";
  const pctSign = nav.session_pnl_pct >= 0 ? "+" : "";
  return [
    `• Free cash (USDT): $${nav.available_usdt.toFixed(2)}`,
    nav.open_positions_usdt > 0
      ? `• Open legs (${openLegCount}): $${nav.open_positions_usdt.toFixed(2)} at mark`
      : openLegCount > 0
        ? `• Open legs: ${openLegCount}`
        : null,
    `• Live NAV: $${nav.portfolio_nav_usdt.toFixed(2)} USDT`,
    `• Session P&L: ${pnlSign}$${nav.session_pnl_usdt.toFixed(2)} (${pctSign}${nav.session_pnl_pct}%) vs $${nav.starting_usdt.toFixed(2)} start`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function humanPaperScalpReason(summary: string): string {
  const fixed: Record<string, string> = {
    "circuit-breaker":
      "Daily loss limit hit — circuit breaker blocks new entries",
    "no-ema-bullish-cross":
      "No 1h EMA9/21 bullish cross on watched symbols",
    "rsi-overbought":
      "RSI above overbought threshold — skip chasing extended move",
    "holding-position": "Managing open 1h position (ATR stop / TP / EMA exit)",
    "insufficient-balance":
      "Free USDT too low for configured risk slot",
    "insufficient-free-margin-floor":
      "Free cash below $5.50 min-notional floor or sized trade",
    "max-open-positions":
      "Legacy cap — copy-profile max open positions reached",
    "max-open-positions-reached":
      "Max concurrent open positions reached (workspace limit)",
    "no-1m-snapshots":
      "1h indicator snapshots missing (klines blocked or empty)",
    "no-hourly-snapshots":
      "1h indicator snapshots missing (klines blocked or empty)",
  };
  if (fixed[summary]) return fixed[summary];
  if (summary.startsWith("opened:")) {
    return `BUY filled — ${summary.replace("opened:", "").replace(/:/g, " ")}`;
  }
  if (summary.startsWith("closed:")) {
    return `SELL / exit — ${summary.replace("closed:", "").replace(/:/g, " ")}`;
  }
  return summary;
}
