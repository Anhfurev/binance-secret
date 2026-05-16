import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuditDiagnostics,
  computePartialExitStats,
  formatPlaybookLines,
} from "./audit-diagnostics.mjs";

test("computePartialExitStats tracks BE-stop after partial TP", () => {
  const stats = computePartialExitStats([
    { exit_reason: "be_stop_hit", extra: { partial_tp_executed: true } },
    { exit_reason: "be_stop_hit", extra: { partial_tp_executed: true } },
    { exit_reason: "roi_target_hit", extra: { partial_tp_executed: true } },
  ]);
  assert.equal(stats.partialTpCloses, 3);
  assert.equal(stats.beStopAfterPartial, 2);
  assert.equal(stats.beStopAfterPartialPct, (2 / 3) * 100);
});

test("buildAuditDiagnostics flags friction and WFE drift", () => {
  const diagnostics = buildAuditDiagnostics({
    quant: {
      frictionTaxPctOfNet: 35,
      walkForwardEfficiency: 0.7,
      avgProfitFactor7d: 1.6,
    },
    partialExit: { partialTpCloses: 0, beStopHits: 0 },
    topBlockers: [{ reason: "hold_wide_spread_12bps_gt_10", count: 4 }],
  });
  assert.equal(diagnostics.frictionElevated, true);
  assert.equal(diagnostics.wfeRegimeShift, true);
  assert.equal(diagnostics.chaosBlockers.length, 1);
  const lines = formatPlaybookLines(diagnostics);
  assert.equal(lines.length, 2);
});
