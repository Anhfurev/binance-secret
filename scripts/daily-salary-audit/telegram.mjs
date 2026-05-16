import { formatWatchdogBlockerLines } from "./blocker-watchdog.mjs";
import { formatPlaybookLines } from "./audit-diagnostics.mjs";
import { optionalEnv, readDailyLossLimitUsd, readTelegramChatId } from "./env.mjs";

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0.00";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.0";
  return n.toFixed(1);
}

function formatBlockers(topBlockers) {
  if (!topBlockers.length) return "None recorded";
  return topBlockers
    .map((row) => `${row.reason} (${row.count})`)
    .join(", ");
}

function formatSymbolSummary(rows) {
  if (!rows.length) return "No closed trades";
  return rows
    .slice(0, 4)
    .map(
      (row) =>
        `${row.symbol}: ${money(row.netPnl)} · ${row.trades} trades · W/L ${row.wins}/${row.losses}`,
    )
    .join("\n");
}

function ratio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "n/a";
  return n.toFixed(2);
}

function formatQuantSection(metrics) {
  const quant = metrics.quant ?? {};
  const pf = quant.profitFactor;
  const pfLabel = pf == null ? "n/a" : ratio(pf);
  const pfTarget = quant.profitFactorTarget ?? 1.5;
  const pfFlag = pf != null && pf < pfTarget ? " ⚠️" : "";
  const wfe = quant.walkForwardEfficiency;
  const wfeLabel = wfe == null ? "n/a" : ratio(wfe);
  const frictionPct =
    quant.frictionTaxPctOfNet == null
      ? "n/a"
      : `${pct(quant.frictionTaxPctOfNet)}%`;
  const frictionFlag =
    metrics.diagnostics?.frictionElevated ? " ⚠️" : "";
  const wfeFlag = metrics.diagnostics?.wfeRegimeShift ? " ⚠️" : "";
  const partial = metrics.partialExit ?? {};
  const beRatioLabel =
    partial.partialTpCloses > 0
      ? `${partial.beStopAfterPartial}/${partial.partialTpCloses} (${partial.beStopAfterPartialPct == null ? "n/a" : `${pct(partial.beStopAfterPartialPct)}%`})`
      : partial.beStopHits > 0
      ? `${partial.beStopHits} BE-stop closes (no partial_tp flags)`
      : "n/a";
  return [
    `📊 <b>Profit Factor:</b> ${pfLabel} (target &gt; ${ratio(pfTarget)})${pfFlag}`,
    `🎯 <b>Expectancy:</b> ${money(quant.expectancyUsd ?? 0)}/trade`,
    `🔁 <b>Walk-Forward Eff:</b> ${wfeLabel} (24h PF ${ratio(quant.profitFactor24h)} vs 7d avg ${ratio(quant.avgProfitFactor7d)})${wfeFlag}`,
    `🧾 <b>Friction Tax:</b> ${money(metrics.feesUsd)} fees · ${frictionPct} of net${frictionFlag}`,
    `🛡️ <b>BE-Stop After Partial:</b> ${beRatioLabel}`,
    `⏱️ <b>Hold Time:</b> avg ${pct(metrics.avgHoldMinutes)} min · median ${pct(metrics.medianHoldMinutes)} min`,
  ];
}

function formatPlaybookSection(metrics) {
  const lines = formatPlaybookLines(metrics.diagnostics ?? {});
  if (!lines.length) return [];
  return ["", "🧠 <b>Playbook</b>", ...lines.map((line) => escapeHtml(line))];
}

function formatWatchdogSection(metrics) {
  const watchdog = metrics.watchdogBlockers;
  if (!watchdog?.rows?.length) return [];
  const title = watchdog.isActive
    ? "🟢 <b>Activity Watchdog</b> (gates firing — bot is not frozen)"
    : "⚪ <b>Activity Watchdog</b>";
  const lines = formatWatchdogBlockerLines(watchdog).map(
    (row) => `• <b>${escapeHtml(row.label)}:</b> ${row.count} — ${escapeHtml(row.hint)}`,
  );
  if (!watchdog.isActive) {
    lines.push(
      `• ${escapeHtml("No War Room / confidence / spread blocks in this window — if there are still no buys, check upstream strategy or max-open-trades gates.")}`,
    );
  }
  return ["", title, ...lines];
}

export function formatDailySalaryTelegram(metrics) {
  const whale =
    metrics.whaleSentiment == null
      ? "n/a"
      : metrics.whaleSentiment.toFixed(2);
  const lines = [
    "--- 🏢 <b>ITHM DAILY PERFORMANCE REPORT</b> 🏢 ---",
    `📅 <b>UTC day:</b> ${escapeHtml(metrics.window.labelUtc)}`,
    `💰 <b>Net Salary Today:</b> ${money(metrics.netPnl)}`,
    `📈 <b>Win Rate:</b> ${pct(metrics.winRatePct)}% (${metrics.wins}W / ${metrics.losses}L)`,
    ...formatQuantSection(metrics),
    ...formatPlaybookSection(metrics),
    ...formatWatchdogSection(metrics),
    `📉 <b>Intraday Drawdown:</b> ${money(metrics.drawdownUsd)}`,
    `🚫 <b>Top Blockers:</b> ${escapeHtml(formatBlockers(metrics.topBlockers))}`,
    `🐳 <b>Whale Sentiment:</b> ${whale}`,
    `<b>By symbol</b>\n${escapeHtml(formatSymbolSummary(metrics.bySymbol))}`,
    "--------------------------------------------",
    `<i>${metrics.closedCount} closes · fees ${money(metrics.feesUsd)} · equity ${money(metrics.endingEquity)}</i>`,
  ];

  const lossLimit = readDailyLossLimitUsd();
  if (metrics.netPnl < 0) {
    lines.push(
      "",
      "⚠️ <b>Risk Warning</b>",
      `Realized net is ${money(metrics.netPnl)}. Daily loss guardrail: ${money(lossLimit)}.`,
      `Profile drawdown limit: ${pct(metrics.maxDrawdownLimitPct)}%.`,
    );
  }
  return lines.join("\n");
}

export async function sendTelegramReport(text) {
  if (optionalEnv("DAILY_SALARY_DRY_RUN") === "1") {
    console.log(text);
    return { ok: true, dryRun: true };
  }
  const token = optionalEnv("TELEGRAM_BOT_TOKEN");
  const chatId = readTelegramChatId();
  if (!token || !chatId) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  }
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    },
  );
  const body = await response.json();
  if (!response.ok || body.ok !== true) {
    throw new Error(
      `Telegram send failed: ${response.status} ${JSON.stringify(body).slice(0, 240)}`,
    );
  }
  return { ok: true, messageId: body.result?.message_id ?? null };
}
