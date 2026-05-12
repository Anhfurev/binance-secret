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
  const supabase = createAuditSupabase();

  const [trades, wallet, blockerLogs, warRoomAudits] = await Promise.all([
    fetchClosedTrades(supabase, window.startIso, window.endIso),
    fetchWalletSnapshot(supabase),
    fetchBuyBlockerLogs(supabase, window.startIso, window.endIso),
    fetchWarRoomAudits(supabase, window.startIso, window.endIso),
  ]);

  const metrics = buildAuditMetrics({
    trades,
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
    telegram,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[daily-salary-audit]", error);
  process.exitCode = 1;
});
