// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const WIN_REASONS = new Set([
  "take_profit",
  "signal_exit",
  "roi_target_hit",
  "money_machine_trailing_lock",
]);
const LOSS_REASONS = new Set([
  "stoploss_hit",
  "trailing_stop_hit",
  "money_machine_hard_stop",
]);

function toNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function tradeFeesUsd(extra: Record<string, unknown> | null | undefined): number {
  if (!extra) return 0;
  return (
    toNum(extra.fee_usd_buy, 0) +
    toNum(extra.fee_usd_sell, 0) +
    toNum(extra.fee_usd, 0)
  );
}

function holdMinutes(openedAt: unknown, closedAt: unknown): number | null {
  const opened = Date.parse(String(openedAt ?? ""));
  const closed = Date.parse(String(closedAt ?? ""));
  if (!Number.isFinite(opened) || !Number.isFinite(closed) || closed < opened) {
    return null;
  }
  return (closed - opened) / 60_000;
}

function parseVetoReasons(vetoDetails: unknown): string[] {
  if (!vetoDetails) return [];
  if (typeof vetoDetails === "object") {
    const reasons = (vetoDetails as { veto_reasons?: unknown }).veto_reasons;
    return Array.isArray(reasons) ? reasons.map((r) => String(r)) : [];
  }
  try {
    const parsed = JSON.parse(String(vetoDetails));
    if (Array.isArray(parsed?.veto_reasons)) {
      return parsed.veto_reasons.map((r: unknown) => String(r));
    }
  } catch {
    return [String(vetoDetails).slice(0, 96)];
  }
  return [];
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function money(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export async function runDailySalaryAudit(supabase: ReturnType<typeof createClient>) {
  const hours = Math.min(168, Math.max(1, Number(Deno.env.get("DAILY_SALARY_LOOKBACK_HOURS") ?? "24")));
  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const labelUtc = endIso.slice(0, 10);

  const [tradesRes, walletRes, logsRes, warRes] = await Promise.all([
    supabase
      .from("trades")
      .select("symbol,exit_reason,pnl,opened_at,closed_at,extra")
      .in("status", ["closed", "stopped"])
      .gte("closed_at", startIso)
      .lte("closed_at", endIso)
      .order("closed_at", { ascending: true }),
    supabase
      .from("profiles")
      .select("demo_balance,max_drawdown_limit")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("logs")
      .select("message,meta")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .in("message", [
        "execution_hold",
        "execution_skip",
        "war_room_quorum_gate",
        "war_room_news_veto",
        "buy_flow_skip",
      ])
      .limit(2000),
    supabase
      .from("war_room_audits")
      .select("final_decision,veto_details")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .limit(2000),
  ]);
  if (tradesRes.error) throw tradesRes.error;
  if (walletRes.error) throw walletRes.error;
  if (logsRes.error) throw logsRes.error;
  if (warRes.error) throw warRes.error;

  const trades = tradesRes.data ?? [];
  let grossPnl = 0;
  let feesUsd = 0;
  let wins = 0;
  let losses = 0;
  let runningNet = 0;
  let peakNet = 0;
  const holdMinutesList: number[] = [];
  const imbalanceSamples: number[] = [];
  const bySymbol = new Map<string, { symbol: string; trades: number; netPnl: number }>();
  const blockerCounts = new Map<string, number>();

  for (const row of trades) {
    const pnl = toNum(row.pnl, 0);
    const fee = tradeFeesUsd(row.extra as Record<string, unknown>);
    const net = pnl - fee;
    grossPnl += pnl;
    feesUsd += fee;
    runningNet += net;
    peakNet = Math.max(peakNet, runningNet);
    const reason = String(row.exit_reason ?? "").toLowerCase();
    if (WIN_REASONS.has(reason) || (reason === "signal_exit" && pnl > 0)) wins += 1;
    else if (LOSS_REASONS.has(reason) || pnl < 0) losses += 1;
    const sym = String(row.symbol ?? "UNKNOWN");
    const bucket = bySymbol.get(sym) ?? { symbol: sym, trades: 0, netPnl: 0 };
    bucket.trades += 1;
    bucket.netPnl += net;
    bySymbol.set(sym, bucket);
    const hold = holdMinutes(row.opened_at, row.closed_at);
    if (hold != null) holdMinutesList.push(hold);
    const meta = row.extra as Record<string, unknown> | undefined;
    const smartMeta = meta?.smart_execution_meta as Record<string, unknown> | undefined;
    const imb = toNum(smartMeta?.imbalance_ratio, NaN);
    if (Number.isFinite(imb)) imbalanceSamples.push(imb);
  }

  for (const row of logsRes.data ?? []) {
    const meta = (row.meta as Record<string, unknown> | undefined) ?? {};
    const key = String(meta.hold_reason ?? meta.reason ?? meta.detail ?? row.message);
    blockerCounts.set(key, (blockerCounts.get(key) ?? 0) + 1);
  }
  for (const row of warRes.data ?? []) {
    const decision = String(row.final_decision ?? "").toUpperCase();
    if (decision && decision !== "BUY") {
      const key = `war_room:${decision}`;
      blockerCounts.set(key, (blockerCounts.get(key) ?? 0) + 1);
    }
    for (const reason of parseVetoReasons(row.veto_details)) {
      blockerCounts.set(reason, (blockerCounts.get(reason) ?? 0) + 1);
    }
  }

  const netPnl = grossPnl - feesUsd;
  const decided = wins + losses;
  const winRatePct = decided > 0 ? (wins / decided) * 100 : 0;
  const avgHoldMinutes = holdMinutesList.length
    ? holdMinutesList.reduce((a, b) => a + b, 0) / holdMinutesList.length
    : 0;
  const endingEquity = toNum(walletRes.data?.demo_balance, 0);
  const peakEquity = endingEquity - netPnl + peakNet;
  const drawdownUsd = Math.max(0, peakEquity - endingEquity);
  const topBlockers = [...blockerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => `${reason} (${count})`)
    .join(", ") || "None recorded";
  const whale = imbalanceSamples.length
    ? (imbalanceSamples.reduce((a, b) => a + b, 0) / imbalanceSamples.length).toFixed(2)
    : "n/a";
  const symbolLines = [...bySymbol.values()]
    .sort((a, b) => b.netPnl - a.netPnl)
    .slice(0, 4)
    .map((row) => `${row.symbol}: ${money(row.netPnl)} · ${row.trades} trades`)
    .join("\n") || "No closed trades";

  const lossLimit = toNum(Deno.env.get("DAILY_SALARY_LOSS_LIMIT_USD"), 75);
  const risk = netPnl < 0
    ? `\n\n⚠️ <b>Risk Warning</b>\nRealized net is ${money(netPnl)}. Daily loss guardrail: ${money(lossLimit)}.`
    : "";

  const text = [
    "--- 🏢 <b>ITHM DAILY PERFORMANCE REPORT</b> 🏢 ---",
    `📅 <b>UTC day:</b> ${escapeHtml(labelUtc)}`,
    `💰 <b>Net Salary Today:</b> ${money(netPnl)}`,
    `📈 <b>Win Rate:</b> ${winRatePct.toFixed(1)}% (${wins}W / ${losses}L)`,
    `⏱️ <b>Avg Hold Time:</b> ${avgHoldMinutes.toFixed(1)} min`,
    `📉 <b>Intraday Drawdown:</b> ${money(drawdownUsd)}`,
    `🚫 <b>Top Blockers:</b> ${escapeHtml(topBlockers)}`,
    `🐳 <b>Whale Sentiment:</b> ${whale}`,
    `<b>By symbol</b>\n${escapeHtml(symbolLines)}`,
    "--------------------------------------------",
    `<i>${trades.length} closes · fees ${money(feesUsd)} · equity ${money(endingEquity)}</i>`,
    risk,
  ].join("\n");

  return {
    text,
    metrics: {
      netPnl,
      winRatePct,
      closedCount: trades.length,
      avgHoldMinutes,
      drawdownUsd,
    },
  };
}
