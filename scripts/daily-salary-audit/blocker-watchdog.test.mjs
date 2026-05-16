import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateWatchdogBlockers,
  classifyWatchdogBlocker,
} from "./blocker-watchdog.mjs";

test("classifyWatchdogBlocker maps war room, confidence, and spread", () => {
  assert.equal(classifyWatchdogBlocker("war_room:HOLD"), "warRoomHold");
  assert.equal(
    classifyWatchdogBlocker("BUY blocked: effective confidence 58.00% < STABLE floor 62%"),
    "minConfidence",
  );
  assert.equal(classifyWatchdogBlocker("hold_wide_spread_12bps_gt_10"), "spreadWide");
});

test("aggregateWatchdogBlockers rolls up gate families", () => {
  const counts = new Map([
    ["war_room:HOLD", 4],
    ["FAIL_WIDE_SPREAD", 2],
    ["BUY blocked: effective confidence 58.00% < STABLE floor 62%", 3],
    ["hold_max_open_trades_limit", 9],
  ]);
  const watchdog = aggregateWatchdogBlockers(counts);
  assert.equal(watchdog.totals.warRoomHold, 4);
  assert.equal(watchdog.totals.spreadWide, 2);
  assert.equal(watchdog.totals.minConfidence, 3);
  assert.equal(watchdog.isActive, true);
});
