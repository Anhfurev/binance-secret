import { assertEquals } from "jsr:@std/assert";
import {
  isPartialSellFill,
  shouldApplyPaperBalanceOnSellFinancials,
} from "../sell-financials.ts";
import { computeNetTradePnl } from "../fill-fees.ts";

Deno.test("partial sell allocates buy fee pro-rata", () => {
  const pnl = computeNetTradePnl({
    qty: 0.5,
    entryPrice: 100,
    exitPrice: 102,
    feeUsdBuy: 0.2,
    feeUsdSell: 0.1,
  });
  assertEquals(pnl, 0.7);
});

Deno.test("full fill when sold equals open amount", () => {
  assertEquals(isPartialSellFill(1, 1), false);
});

Deno.test("partial fill when sold below open amount", () => {
  assertEquals(isPartialSellFill(1, 0.5), true);
});

Deno.test("treats near-full fill as full", () => {
  assertEquals(isPartialSellFill(1, 0.9995), false);
});

Deno.test("paper balance on full sell only", () => {
  assertEquals(shouldApplyPaperBalanceOnSellFinancials(true, false), true);
  assertEquals(shouldApplyPaperBalanceOnSellFinancials(true, true), false);
  assertEquals(shouldApplyPaperBalanceOnSellFinancials(false, false), false);
});
