// @ts-nocheck
/**
 * Cron batch HTML digest per `BotActionResult`.
 * Requires `CRON_SUPER_DETAILED_TRACE_TELEGRAM=1` **and** `TELEGRAM_NOTIFY_ERRORS` set to a non-empty
 * value other than `false` (e.g. `true` or `1`). If unset or `false`, sends are muted.
 * Chat: `TELEGRAM_SUPER_TRACE_CHAT_ID` or `TELEGRAM_CHAT_ID` / `TELEGRAM_BOT_CHAT_ID`.
 */
import type { BotActionResult } from "./types.ts";
import { escapeHtml } from "./bot-shared.ts";
import { postTelegramSendMessage } from "./telegram-post-message.ts";
import { formatIndicatorForLog } from "./indicator-precision.ts";
import {
  readTelegramNotifyErrorsAllowsSend,
  readTelegramNotificationsEnabled,
} from "./telegram-notify-policy.ts";

export { readTelegramNotifyErrorsAllowsSend };

export function readSuperDetailedTraceTelegramEnabled(): boolean {
  const raw = String(Deno.env.get("CRON_SUPER_DETAILED_TRACE_TELEGRAM") ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function resolveSuperTraceChatId(): string {
  const a = (Deno.env.get("TELEGRAM_SUPER_TRACE_CHAT_ID") ?? "").trim();
  if (a) return a;
  return (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").trim() ||
    (Deno.env.get("TELEGRAM_BOT_CHAT_ID") ?? "").trim();
}

function fmtNum(n: unknown, digits: number, fallback = "N/A"): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return x.toFixed(digits);
}

function finiteIndicator(n: unknown): number | null {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

/** MACD line / signal / histogram for TAPE MATHEMATICS (flat bot indicators or nested snapshot). */
export function resolveTapeMacdTraceLines(
  ind: BotActionResult["indicators"],
  referencePrice?: number,
): { macd: string; sig: string; hist: string } {
  const na = { macd: "N/A", sig: "N/A", hist: "N/A" };
  if (!ind) return na;

  const raw = ind.macd as unknown;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const macdN = finiteIndicator(o.macd ?? o.MACD);
    const sigN = finiteIndicator(o.signal ?? o.sig ?? o.SIGNAL);
    const histN = finiteIndicator(o.histogram ?? o.hist ?? o.HIST)
      ?? (macdN != null && sigN != null ? macdN - sigN : null);
    return {
      macd: macdN != null ? formatIndicatorForLog(macdN, referencePrice) : "N/A",
      sig: sigN != null ? formatIndicatorForLog(sigN, referencePrice) : "N/A",
      hist: histN != null ? formatIndicatorForLog(histN, referencePrice) : "N/A",
    };
  }

  const macdN = finiteIndicator(ind.macd);
  const sigN = finiteIndicator(ind.macdSignal);
  const histExplicit = finiteIndicator(
    (ind as { macdHistogram?: number }).macdHistogram,
  );
  const histN = histExplicit ?? (macdN != null && sigN != null ? macdN - sigN : null);

  return {
    macd: macdN != null ? formatIndicatorForLog(macdN, referencePrice) : "N/A",
    sig: sigN != null ? formatIndicatorForLog(sigN, referencePrice) : "N/A",
    hist: histN != null ? formatIndicatorForLog(histN, referencePrice) : "N/A",
  };
}

export async function sendSuperDetailedTraceTelegram(
  actionPayload: BotActionResult,
  functionHealth: Record<string, unknown> | null | undefined,
  batchId: string,
): Promise<void> {
  const symbol = String(actionPayload.symbol || "UNKNOWN");
  if (!readTelegramNotifyErrorsAllowsSend()) {
    console.log(
      `[TELEGRAM MUTE] Skipped super trace for ${symbol} (notifications disabled; set TG_NOTIFICATIONS_ENABLED=1)`,
    );
    return;
  }
  if (!readTelegramNotificationsEnabled()) return;

  const telegramBotToken = (Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "").trim();
  const telegramChatId = resolveSuperTraceChatId();
  if (!telegramBotToken || !telegramChatId) {
    console.warn("[super_detailed_trace] missing TELEGRAM_BOT_TOKEN or chat id");
    return;
  }

  const finalDecision = String(actionPayload.decision || "HOLD");
  const strategyReason = String(actionPayload.strategy_reason || "No strategy code emitted");
  const detail = String(actionPayload.detail || "No details provided.");

  const ind = actionPayload.indicators;
  const refPx = Number((actionPayload as Record<string, unknown>).latest_price ?? ind?.ema200 ?? 0);
  const priceRef = Number.isFinite(refPx) && refPx > 0 ? refPx : undefined;
  const { macd: macdStr, sig: macdSigStr, hist: macdHistStr } = resolveTapeMacdTraceLines(
    ind,
    priceRef,
  );
  const rsi = ind ? fmtNum(ind.rsi, 2) : "N/A";
  const emaFast = ind ? formatIndicatorForLog(ind.emaFast, priceRef) : "N/A";
  const emaSlow = ind ? formatIndicatorForLog(ind.emaSlow, priceRef) : "N/A";
  const ema200 = ind?.ema200 != null ? formatIndicatorForLog(ind.ema200, priceRef) : "N/A";

  const ai = actionPayload.ai ?? {};
  const aiProvider = String((ai as Record<string, unknown>).ai_provider ?? "unknown").toUpperCase();
  const aiProviderPath = String((ai as Record<string, unknown>).ai_provider_path ?? "default");
  const aiAction = String((ai as Record<string, unknown>).action ?? "HOLD");
  const aiConfidence = fmtNum((ai as Record<string, unknown>).ai_confidence, 1, "0");
  const groqVerdict = String((ai as Record<string, unknown>).groq_verdict ?? "NONE");
  const groqReason = String((ai as Record<string, unknown>).groq_reason ?? "No text reason provided.");
  const sv = (ai as Record<string, unknown>).sentiment_vibe as Record<string, unknown> | undefined;
  const fng = sv?.fear_greed_value != null ? fmtNum(sv.fear_greed_value, 0) : "N/A";
  const fngLabel = String(sv?.fear_greed_label ?? "Unknown");

  const fh = functionHealth ?? {};
  const healthStatus = String((fh as Record<string, unknown>).status ?? "unknown");
  const snap = (fh as Record<string, unknown>).snapshot as Record<string, unknown> | undefined;
  const openTrades = snap?.open_trades ?? 0;
  const errorLogsLastHour = snap?.error_logs_last_hour ?? 0;

  const bid = escapeHtml(batchId.slice(0, 8));
  const decisionEmoji = finalDecision === "BUY" ? "🟢" : "🛑";
  const healthEmoji = healthStatus === "broken" ? "⚠️" : "✅";

  const message =
    `⚙️ <b>[BOT EXECUTION TRACE] — ${escapeHtml(symbol)}</b>\n` +
    `<code>Batch ID: ${bid}…</code>\n\n` +
    `⚖️ <b>FINAL DECISION:</b> ${decisionEmoji} <b>${escapeHtml(finalDecision)}</b>\n` +
    `💬 <b>Matrix Detail:</b> <i>${escapeHtml(detail)}</i>\n` +
    `🛡️ <b>Strategy Code:</b> <code>${escapeHtml(strategyReason)}</code>\n\n` +
    `--- 📊 <b>TAPE MATHEMATICS</b> ---\n` +
    `• <b>RSI:</b> <code>${escapeHtml(rsi)}</code>\n` +
    `• <b>MACD:</b> <code>${escapeHtml(macdStr)}</code> | <b>Signal:</b> <code>${escapeHtml(macdSigStr)}</code> | <b>Hist:</b> <code>${escapeHtml(macdHistStr)}</code>\n` +
    `• <b>Moving Averages:</b> Fast: <code>${escapeHtml(emaFast)}</code> | Slow: <code>${escapeHtml(emaSlow)}</code> | EMA200: <code>${escapeHtml(ema200)}</code>\n\n` +
    `--- 🧠 <b>AI INTELLIGENCE CORE</b> ---\n` +
    `• <b>Engine:</b> <code>${escapeHtml(aiProvider)}</code> (${escapeHtml(aiProviderPath)})\n` +
    `• <b>Raw AI Intent:</b> <b>${escapeHtml(aiAction)}</b> (Confidence: <code>${escapeHtml(aiConfidence)}%</code>)\n` +
    `• <b>Veto layer:</b> <code>${escapeHtml(groqVerdict)}</code>\n` +
    `• <b>AI Rationale:</b> <i>${escapeHtml(groqReason)}</i>\n` +
    `• <b>Fear &amp; Greed:</b> <code>${escapeHtml(fng)} (${escapeHtml(fngLabel)})</code>\n\n` +
    `--- 🩺 <b>SYSTEM HEALTH</b> ---\n` +
    `• <b>Status:</b> ${healthEmoji} <code>${escapeHtml(healthStatus.toUpperCase())}</code>\n` +
    `• <b>Open trades:</b> <code>${escapeHtml(String(openTrades))}</code>\n` +
    `• <b>Errors (1h):</b> <code>${escapeHtml(String(errorLogsLastHour))}</code>\n`;

  const res = await postTelegramSendMessage({
    token: telegramBotToken,
    chatId: telegramChatId,
    text: message,
    parseMode: "HTML",
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`telegram_super_trace:${res.status}:${t.slice(0, 200)}`);
  }
}
