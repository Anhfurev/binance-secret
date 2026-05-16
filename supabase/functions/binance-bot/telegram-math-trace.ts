// @ts-nocheck
/**
 * Optional cron-time tape snapshot → Telegram (no DB / no bot row).
 * Enable: `CRON_MATH_TRACE_TELEGRAM=1`. Optional: `TELEGRAM_DEBUG_CHAT_ID` (else primary chat).
 */
import type { IndicatorSnapshot } from "./types.ts";
import { escapeHtml } from "./bot-shared.ts";
import { checkEntryConditions } from "./strategy.ts";
import { dominantStrategyLabel } from "./telegram-strategy-gate-format.ts";
import { sendTelegramDebugMessage } from "./notifier.ts";
import { formatIndicatorForLog } from "./indicator-precision.ts";
import { describeThrownValue } from "./utils.ts";

export function readCronMathTraceTelegramEnabled(): boolean {
  const raw = String(Deno.env.get("CRON_MATH_TRACE_TELEGRAM") ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function isUsableSnapshot(s: unknown): s is IndicatorSnapshot {
  if (s == null || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  if (typeof o.symbol !== "string" || !o.symbol.length) return false;
  const px = Number(o.latestPrice);
  if (!Number.isFinite(px) || px <= 0) return false;
  if (!Array.isArray(o.candles5)) return false;
  if (o.macd == null || typeof o.macd !== "object") return false;
  return true;
}

function formatMacdLine(snapshot: IndicatorSnapshot): string {
  const m = snapshot.macd;
  if (!m || typeof m !== "object") return "n/a";
  const ref = Number(snapshot.latestPrice);
  const line = (n: unknown) => formatIndicatorForLog(n, ref);
  const rec = m as Record<string, unknown>;
  return `${line(rec.macd)} | sig ${line(rec.signal)} | hist ${line(rec.histogram)}`;
}

export async function sendCronMathTraceTelegram(params: {
  symbol: string;
  snapshot: IndicatorSnapshot;
  batchId?: string | null;
}): Promise<void> {
  try {
    const symbol = typeof params?.symbol === "string" ? params.symbol.trim() : "";
    if (!symbol.length) {
      console.warn("[telegram-math-trace] skip: empty symbol");
      return;
    }
    const snapshot = params?.snapshot;
    if (!isUsableSnapshot(snapshot)) {
      console.warn(`[telegram-math-trace] skip: bad snapshot symbol=${symbol}`);
      return;
    }

    let strategyResult: ReturnType<typeof checkEntryConditions>;
    try {
      strategyResult = checkEntryConditions(snapshot, {
        paperExploration: false,
        botSettings: null,
      });
    } catch (gateErr) {
      console.warn(
        `[telegram-math-trace] checkEntryConditions failed symbol=${symbol}:`,
        describeThrownValue(gateErr),
      );
      return;
    }

    const strategyFailDetail = strategyResult.signal === "BUY"
      ? null
      : `FAIL_STRATEGY:${String(strategyResult.strategy_fail_detail ?? "NO_BUY")}`;
    const dominant = dominantStrategyLabel(strategyResult, strategyFailDetail);
    const rsiStr = Number.isFinite(Number(snapshot.rsi)) ? Number(snapshot.rsi).toFixed(2) : "n/a";
    const macdStr = formatMacdLine(snapshot);
    const statusLine = strategyResult.signal === "BUY"
      ? "Strategy entry pattern satisfied on this snapshot (BB/RSI/momentum math)."
      : "Status: Force hold via strategy rules (no entry signal on this snapshot).";

    const html =
      `<b>📊 MATH TRACE</b> ${escapeHtml(symbol)}\n` +
      `<b>Strategy gate</b>: <code>${escapeHtml(dominant)}</code>\n` +
      `<b>RSI</b>: ${escapeHtml(rsiStr)} · <b>MACD</b>: ${escapeHtml(macdStr)}\n` +
      `<b>Regime</b>: ${escapeHtml(String(snapshot.marketRegime ?? "n/a"))} · ` +
      `<b>Strategy signal</b>: ${escapeHtml(String(strategyResult.signal))}\n` +
      `<b>${escapeHtml(statusLine)}</b>`;

    try {
      await sendTelegramDebugMessage(html, { cycleId: params.batchId ?? null });
    } catch (tgErr) {
      console.warn(
        `[telegram-math-trace] sendTelegramDebugMessage failed symbol=${symbol}:`,
        describeThrownValue(tgErr),
      );
    }
  } catch (outer) {
    console.error(
      "[telegram-math-trace] sendCronMathTraceTelegram outer:",
      describeThrownValue(outer),
    );
  }
}
