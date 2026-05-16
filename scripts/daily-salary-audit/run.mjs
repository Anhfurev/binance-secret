#!/usr/bin/env node
import { readAuditLookbackHours } from "./env.mjs";
import {
  fetchBuyBlockerLogs,
  fetchClosedTrades,
  fetchWalletSnapshot,
  fetchWarRoomAudits,
} from "./fetch.mjs";
import { buildAuditMetrics } from "./metrics.mjs";
import { auditWindowIso, createAuditSupabase } from "./supabase.mjs";
import { formatDailySalaryTelegram, sendTelegramReport } from "./telegram.mjs";

async function main() {
  const hours = readAuditLookbackHours();
  const window = auditWindowIso(hours);
  const window24h = auditWindowIso(24);
  const window7d = auditWindowIso(168);
  const supabase = createAuditSupabase();

  const [trades, trades24h, trades7d, wallet, blockerLogs, warRoomAudits] = await Promise.all([
    fetchClosedTrades(supabase, window.startIso, window.endIso),
    fetchClosedTrades(supabase, window24h.startIso, window24h.endIso),
    fetchClosedTrades(supabase, window7d.startIso, window7d.endIso),
    fetchWalletSnapshot(supabase),
    fetchBuyBlockerLogs(supabase, window.startIso, window.endIso),
    fetchWarRoomAudits(supabase, window.startIso, window.endIso),
  ]);

  const metrics = buildAuditMetrics({
    trades,
    trades24h,
    trades7d,
    wallet,
    blockerLogs,
    warRoomAudits,
    window,
  });

  const report = formatDailySalaryTelegram(metrics);
  const telegram = await sendTelegramReport(report);

  const summary = {
    ok: true,
    window,
    netPnl: Number(metrics.netPnl.toFixed(4)),
    winRatePct: Number(metrics.winRatePct.toFixed(2)),
    closedCount: metrics.closedCount,
    profitFactor: metrics.quant?.profitFactor ?? null,
    expectancyUsd: metrics.quant?.expectancyUsd ?? null,
    walkForwardEfficiency: metrics.quant?.walkForwardEfficiency ?? null,
    frictionTaxPctOfNet: metrics.quant?.frictionTaxPctOfNet ?? null,
    medianHoldMinutes: Number(metrics.medianHoldMinutes.toFixed(2)),
    telegram,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[daily-salary-audit]", error);
  process.exitCode = 1;
});
