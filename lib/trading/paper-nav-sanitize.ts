import { resolvePaperScalpWalletUsd } from "@/lib/trading/paper-scalp-wallet";
import type { PaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import type { DemoAccount, DemoTrade } from "@/lib/types";

function finiteOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function isValidPaperOpenLeg(leg: DemoTrade): boolean {
  const entry = finiteOr(leg.entryPrice, 0);
  const qty = finiteOr(leg.amount, 0);
  return entry > 0 && qty > 0 && Boolean(leg.symbol?.trim());
}

/** Drop corrupt legs (0 entry/qty) that break NAV and Telegram formatting. */
export function stripInvalidOpenLegs(account: DemoAccount): DemoAccount {
  const openPositions = account.openPositions.filter(isValidPaperOpenLeg);
  if (openPositions.length === account.openPositions.length) return account;
  return { ...account, openPositions };
}

export function sanitizePaperWorkspaceNav(nav: PaperWorkspaceNav): PaperWorkspaceNav {
  const wallet = resolvePaperScalpWalletUsd();
  const available_usdt = Number(
    Math.max(0, finiteOr(nav.available_usdt, wallet)).toFixed(4),
  );
  const open_positions_usdt = Number(
    Math.max(0, finiteOr(nav.open_positions_usdt, 0)).toFixed(4),
  );
  let portfolio_nav_usdt = finiteOr(nav.portfolio_nav_usdt, NaN);
  if (!Number.isFinite(portfolio_nav_usdt) || portfolio_nav_usdt < 0) {
    portfolio_nav_usdt = available_usdt + open_positions_usdt;
  }
  portfolio_nav_usdt = Number(Math.max(0, portfolio_nav_usdt).toFixed(4));

  const starting_usdt = Number(
    Math.max(0, finiteOr(nav.starting_usdt, wallet)).toFixed(4),
  );
  const session_pnl_usdt = Number(
    (portfolio_nav_usdt - starting_usdt).toFixed(4),
  );
  const session_pnl_pct =
    starting_usdt > 0
      ? Number(((session_pnl_usdt / starting_usdt) * 100).toFixed(4))
      : 0;

  const open_unrealized_pnl_usdt = Number(
    finiteOr(nav.open_unrealized_pnl_usdt, 0).toFixed(4),
  );

  return {
    ...nav,
    available_usdt,
    open_positions_usdt,
    portfolio_nav_usdt,
    starting_usdt,
    session_pnl_usdt,
    session_pnl_pct,
    open_unrealized_pnl_usdt,
    pnl_24h_usdt:
      nav.pnl_24h_usdt != null && Number.isFinite(nav.pnl_24h_usdt)
        ? Number(nav.pnl_24h_usdt.toFixed(4))
        : nav.pnl_24h_usdt ?? null,
    pnl_7d_usdt:
      nav.pnl_7d_usdt != null && Number.isFinite(nav.pnl_7d_usdt)
        ? Number(nav.pnl_7d_usdt.toFixed(4))
        : nav.pnl_7d_usdt ?? null,
  };
}

/** Safe NAV for DB insert — never NaN/null. */
export function coerceNavUsdtForSnapshot(nav: PaperWorkspaceNav): number {
  const clean = sanitizePaperWorkspaceNav(nav);
  return clean.portfolio_nav_usdt;
}
