/**
 * Non-blocking Telegram alerts for the paper-scalp engine (Next.js server).
 * Fire-and-forget: never await in the hot tick path.
 */

import { formatMicroPrice } from "@/lib/trading/micro-price";
import {
  formatNavTelegramBlock,
  humanPaperScalpReason,
  type PaperWorkspaceNav,
} from "@/lib/trading/paper-scalp-nav";

const SKIP_THROTTLE_MS = 90_000;
const lastSkipSentAt = new Map<string, number>();

function resolveToken(): string {
  return (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
}

function resolveChatId(): string {
  return (process.env.TELEGRAM_CHAT_ID ?? "").trim();
}

function fmtUsd(n: number, digits?: number): string {
  if (digits != null && Math.abs(n) >= 0.01) {
    return `$${Number(n).toFixed(digits)}`;
  }
  return `$${formatMicroPrice(n)}`;
}

function fmtNum(n: number, _digits = 6): string {
  return formatMicroPrice(n);
}

/** POST to Telegram without blocking callers. Missing env → silent no-op. */
export function sendTelegramNotification(message: string): void {
  const token = resolveToken();
  const chatId = resolveChatId();
  if (!token || !chatId || !message.trim()) return;

  const text = message.slice(0, 4096);
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  setImmediate(() => {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.error(
            `[paper-scalp-telegram] HTTP ${res.status}`,
            body.slice(0, 400),
          );
        }
      })
      .catch((err) => {
        console.error("[paper-scalp-telegram] network error:", err);
      });
  });
}

function shouldThrottleSkip(key: string): boolean {
  const now = Date.now();
  const prev = lastSkipSentAt.get(key) ?? 0;
  if (now - prev < SKIP_THROTTLE_MS) return true;
  lastSkipSentAt.set(key, now);
  return false;
}

export function notifyPaperScalpBuy(params: {
  symbol: string;
  entryPrice: number;
  positionSizeUsd: number;
  stopLoss: number;
  takeProfit: number;
  ema9: number;
  ema21: number;
  atr14: number;
  nav?: PaperWorkspaceNav;
}): void {
  const { symbol, entryPrice, positionSizeUsd, stopLoss, takeProfit, ema9, ema21, atr14, nav } =
    params;
  const lines = [
    `🚀 *[paper-scalp] BUY SIGNAL | ${symbol}*`,
    `• Entry Price: ${fmtUsd(entryPrice, entryPrice >= 1 ? 4 : 6)}`,
    `• Size Allocated: ${fmtUsd(positionSizeUsd)}`,
    `• ATR Stop Loss: ${fmtUsd(stopLoss, stopLoss >= 1 ? 4 : 6)}`,
    `• Target TP: ${fmtUsd(takeProfit, takeProfit >= 1 ? 4 : 6)}`,
    `• Indicators: EMA9: ${fmtNum(ema9)} | EMA21: ${fmtNum(ema21)} | ATR: ${fmtNum(atr14, 8)}`,
  ];
  if (nav) lines.push(formatNavTelegramBlock(nav));
  sendTelegramNotification(lines.join("\n"));
}

export function notifyPaperScalpExit(params: {
  symbol: string;
  reason: string;
  exitPrice: number;
  performancePct: number;
  entryPrice?: number;
  pnlUsd?: number;
  nav?: PaperWorkspaceNav;
}): void {
  const { symbol, reason, exitPrice, performancePct, entryPrice, pnlUsd, nav } = params;
  const lines = [
    `🔒 *[paper-scalp] POSITION CLOSED | ${symbol}*`,
    `• Reason: \`${reason}\``,
    `• Why: ${humanPaperScalpReason(`closed:${symbol}:${reason}`)}`,
    `• Exit Price: ${fmtUsd(exitPrice, exitPrice >= 1 ? 4 : 6)}`,
    `• Performance: ${performancePct >= 0 ? "+" : ""}${fmtNum(performancePct, 3)}%`,
  ];
  if (entryPrice != null) {
    lines.push(`• Entry Price: ${fmtUsd(entryPrice, entryPrice >= 1 ? 4 : 6)}`);
  }
  if (pnlUsd != null) {
    lines.push(`• PnL: ${pnlUsd >= 0 ? "+" : ""}${fmtUsd(pnlUsd)}`);
  }
  if (nav) lines.push(formatNavTelegramBlock(nav));
  sendTelegramNotification(lines.join("\n"));
}

export function notifyPaperScalpDecision(params: {
  kind: "skip" | "hold" | "status";
  reason: string;
  symbol?: string;
  details?: Record<string, string | number | boolean | null | undefined>;
  throttleKey?: string;
  nav?: PaperWorkspaceNav;
}): void {
  const key = params.throttleKey ?? `${params.kind}:${params.reason}:${params.symbol ?? "all"}`;
  if (
    (params.kind === "skip" || params.kind === "hold") &&
    shouldThrottleSkip(key)
  ) {
    return;
  }

  const title =
    params.kind === "hold"
      ? `📊 *[paper-scalp] HOLD | ${params.symbol ?? "—"}*`
      : params.kind === "status"
        ? `ℹ️ *[paper-scalp] STATUS*`
        : `⏭️ *[paper-scalp] NO TRADE*`;

  const lines = [
    title,
    `• Reason: \`${params.reason}\``,
    `• Why no trade: ${humanPaperScalpReason(params.reason)}`,
  ];
  if (params.symbol) lines.push(`• Symbol: \`${params.symbol}\``);
  if (params.nav) lines.push(formatNavTelegramBlock(params.nav));

  if (params.details) {
    for (const [k, v] of Object.entries(params.details)) {
      if (v === undefined || v === null) continue;
      if (k === "balance") continue;
      const label =
        k === "scan"
          ? "Market scan"
          : k === "symbolsScanned"
            ? "Symbols scanned"
            : k;
      lines.push(
        `• ${label}: ${typeof v === "number" && k !== "symbolsScanned" ? fmtNum(v, 4) : String(v)}`,
      );
    }
  }

  sendTelegramNotification(lines.join("\n"));
}

export function formatSnapshotScanLine(
  symbol: string,
  snap: { ema9: number; ema21: number; atr14: number; bullishCross: boolean; bearishCross: boolean },
): string {
  const cross = snap.bullishCross
    ? "bullish ✓"
    : snap.bearishCross
      ? "bearish"
      : "none";
  return (
    `${symbol}: EMA9 ${fmtNum(snap.ema9, 4)} | EMA21 ${fmtNum(snap.ema21, 4)} | ` +
    `ATR ${fmtNum(snap.atr14, 6)} | cross ${cross}`
  );
}
