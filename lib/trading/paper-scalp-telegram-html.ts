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
  return `<b>${escapeTelegramHtml(title)}</b>`;
}

export function tgManifestTitle(title: string): string {
  return `<b>${escapeTelegramHtml(title)}</b>`;
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

/** Manifest-only POST — parse_mode HTML, awaited, logs API errors. */
export async function transmitManifestHtmlDashboard(
  htmlBody: string,
): Promise<void> {
  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID ?? "").trim();
  if (!token || !chatId) {
    console.warn(
      "[paper-scalp-manifest] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing",
    );
    return;
  }
  if (!htmlBody.trim()) return;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: htmlBody.slice(0, 4096),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  const raw = await res.text().catch(() => "");
  let payload: { ok?: boolean; description?: string; result?: { message_id?: number } } =
    {};
  try {
    payload = raw ? (JSON.parse(raw) as typeof payload) : {};
  } catch {
    payload = {};
  }

  if (!res.ok || payload.ok === false) {
    console.error("[paper-scalp-manifest] Telegram HTML rejected", {
      httpStatus: res.status,
      description: payload.description ?? raw.slice(0, 400),
    });
    throw new Error(
      payload.description ?? `Telegram HTTP ${res.status}`,
    );
  }

  console.log("[paper-scalp-manifest] Telegram delivered", {
    messageId: payload.result?.message_id ?? null,
    chatIdSuffix: chatId.slice(-4),
  });
}
