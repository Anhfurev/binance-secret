import { assertEquals } from "jsr:@std/assert";
import {
  readNotionalCapFraction,
  readRiskPerTradePercent,
  resolveRiskToStopNotionalUsd,
} from "../risk-to-stop-sizing.ts";

Deno.test("risk-to-stop defaults to 1% risk and 15% notional cap", () => {
  Deno.env.delete("RISK_PER_TRADE_PERCENT");
  Deno.env.delete("NOTIONAL_CAP_FRACTION");
  assertEquals(readRiskPerTradePercent(), 1);
  assertEquals(readNotionalCapFraction(), 0.15);
});

Deno.test("resolveRiskToStopNotionalUsd sizes from stop distance", () => {
  const sized = resolveRiskToStopNotionalUsd({
    totalEquity: 10_000,
    entryPrice: 100,
    stopLossPrice: 93,
  });
  assertEquals(sized.riskUsd, 100);
  assertEquals(sized.notionalUsd, 1428.57142857);
  assertEquals(sized.cappedByNotional, false);
});

Deno.test("resolveRiskToStopNotionalUsd caps notional at wallet fraction", () => {
  const sized = resolveRiskToStopNotionalUsd({
    totalEquity: 10_000,
    entryPrice: 100,
    stopLossPrice: 99.5,
  });
  assertEquals(sized.notionalUsd, 1500);
  assertEquals(sized.cappedByNotional, true);
});
