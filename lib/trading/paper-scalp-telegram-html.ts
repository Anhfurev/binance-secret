import {
  formatNavUsd,
  formatPct4,
  formatSignedNavUsd,
} from "@/lib/trading/paper-scalp-metrics-format";
import type { PaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";

/** Telegram HTML parse_mode — escape user/dynamic text only. */
export function escapeTelegramHtml(raw: string): string {
  return String(raw)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function tgBold(text: string): string {
  return `<b>${escapeTelegramHtml(text)}</b>`;
}

export function tgCode(text: string): string {
  return `<code>${escapeTelegramHtml(text)}</code>`;
}

export function tgSection(title: string): string {
  return tgBold(title);
}

export function tgBullet(line: string): string {
  return `• ${line}`;
}

export function formatNavHtmlBlock(
  nav: PaperWorkspaceNav,
  openLegCount = 0,
): string {
  const rows = [
    tgBullet(`Free cash (USDT): $${escapeTelegramHtml(formatNavUsd(nav.available_usdt))}`),
    nav.open_positions_usdt > 0
      ? tgBullet(
          `Open legs (${openLegCount}): $${escapeTelegramHtml(formatNavUsd(nav.open_positions_usdt))} at live mark`,
        )
      : openLegCount > 0
        ? tgBullet(`Open legs: ${openLegCount}`)
        : null,
    tgBullet(`Live NAV: $${escapeTelegramHtml(formatNavUsd(nav.portfolio_nav_usdt))} USDT`),
    openLegCount > 0
      ? tgBullet(
          `Open P&amp;L (vs entry): ${escapeTelegramHtml(formatSignedNavUsd(nav.open_unrealized_pnl_usdt))}`,
        )
      : null,
    tgBullet(
      `Session P&amp;L: ${escapeTelegramHtml(formatSignedNavUsd(nav.session_pnl_usdt))} (${escapeTelegramHtml(formatPct4(nav.session_pnl_pct))}) vs $${escapeTelegramHtml(formatNavUsd(nav.starting_usdt))} start`,
    ),
  ];
  return rows.filter(Boolean).join("\n");
}
