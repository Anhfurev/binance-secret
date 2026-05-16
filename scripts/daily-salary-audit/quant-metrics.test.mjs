import test from "node:test";
import assert from "node:assert/strict";
import {
  averageProfitFactor,
  buildQuantMetrics,
  expectancyFromNets,
  frictionTax,
  median,
  profitFactorFromNets,
  walkForwardEfficiency,
} from "./quant-metrics.mjs";

test("profitFactorFromNets divides gains by absolute losses", () => {
  assert.equal(profitFactorFromNets([100, -40, 20, -10]), 2.4);
});

test("expectancyFromNets blends win and loss rates", () => {
  const expectancy = expectancyFromNets([50, 50, -25, -25]);
  assert.equal(expectancy, 12.5);
});

test("median hold time ignores churn outliers", () => {
  assert.equal(median([5, 10, 1000]), 10);
});

test("frictionTax compares fees to net pnl", () => {
  const tax = frictionTax(20, 100);
  assert.equal(tax.pctOfNet, 20);
});

test("walkForwardEfficiency compares 24h PF to 7d average", () => {
  const trades24h = [
    { pnl: 100, extra: {} },
    { pnl: -50, extra: {} },
  ];
  const trades7d = [
    ...trades24h,
    { closed_at: "2026-05-10T12:00:00.000Z", pnl: 40, extra: {} },
    { closed_at: "2026-05-10T13:00:00.000Z", pnl: -20, extra: {} },
    { closed_at: "2026-05-11T12:00:00.000Z", pnl: 30, extra: {} },
    { closed_at: "2026-05-11T13:00:00.000Z", pnl: -30, extra: {} },
  ];
  const quant = buildQuantMetrics({
    trades: trades24h,
    trades24h,
    trades7d,
    feesUsd: 0,
    netPnl: 50,
  });
  assert.equal(quant.profitFactor24h, 2);
  assert.equal(averageProfitFactor(trades7d), 1.5);
  assert.equal(walkForwardEfficiency(2, 1.5), 4 / 3);
  assert.equal(quant.walkForwardEfficiency, 4 / 3);
});
