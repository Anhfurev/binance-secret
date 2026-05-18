import { assertEquals } from "jsr:@std/assert";
import {
  computeAtrExitLevels,
  ATR_STOP_LOSS_MULTIPLIER_DEFAULT,
  ATR_TAKE_PROFIT_MULTIPLIER_DEFAULT,
} from "../atr-exit-targets.ts";

Deno.test("computeAtrExitLevels uses 2x SL and 3.5x TP ATR distances", () => {
  const entry = 100;
  const atr = 2;
  const levels = computeAtrExitLevels(entry, atr, {
    slAtrMult: ATR_STOP_LOSS_MULTIPLIER_DEFAULT,
    tpAtrMult: ATR_TAKE_PROFIT_MULTIPLIER_DEFAULT,
  });
  assertEquals(levels.basis, "atr_scaled");
  assertEquals(levels.stopLoss, 96);
  assertEquals(levels.takeProfit, 107);
  assertEquals(levels.rewardRiskRatio, 1.75);
});

Deno.test("computeAtrExitLevels falls back to pct when ATR invalid", () => {
  const levels = computeAtrExitLevels(50, 0, {
    stopLossPctFraction: 0.02,
    takeProfitPctFraction: 0.04,
  });
  assertEquals(levels.basis, "pct_fallback");
  assertEquals(levels.stopLoss, 49);
  assertEquals(levels.takeProfit, 52);
});
