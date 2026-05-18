import type { CoinData, DemoAccount } from "@/lib/types";

export type PaperWorkspaceNav = {
  available_usdt: number;
  portfolio_nav_usdt: number;
};

export function computePaperWorkspaceNav(
  account: DemoAccount,
  marketCoins: CoinData[] = [],
): PaperWorkspaceNav {
  const available_usdt = Number(
    Math.max(0, account.currentBalance).toFixed(2),
  );

  let openMarkValue = 0;
  for (const pos of account.openPositions) {
    const sym = pos.symbol.toUpperCase().replace(/\//g, "");
    const base = sym.replace(/USDT$/, "").toLowerCase();
    const coin = marketCoins.find((c) => c.symbol.toLowerCase() === base);
    const mark = coin?.current_price ?? pos.entryPrice;
    openMarkValue += pos.amount * mark;
  }

  const portfolio_nav_usdt = Number(
    (available_usdt + openMarkValue).toFixed(2),
  );

  return { available_usdt, portfolio_nav_usdt };
}

export function formatNavTelegramBlock(nav: PaperWorkspaceNav): string {
  return [
    `• Balance: $${nav.available_usdt.toFixed(2)} USDT`,
    `• Live Portfolio Value (NAV): $${nav.portfolio_nav_usdt.toFixed(2)} USDT`,
  ].join("\n");
}

export function humanPaperScalpReason(summary: string): string {
  const fixed: Record<string, string> = {
    "circuit-breaker":
      "Daily loss limit hit — circuit breaker blocks new entries",
    "no-ema-bullish-cross":
      "No 1m EMA9/21 bullish cross on watched symbols",
    "holding-position": "Managing open position (trailing stop / TP / EMA exit)",
    "insufficient-balance":
      "Free USDT too low for the 20% position size slot",
    "max-open-positions":
      "Copy-profile max open positions reached",
    "no-1m-snapshots":
      "1m indicator snapshots missing (klines blocked or empty)",
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
