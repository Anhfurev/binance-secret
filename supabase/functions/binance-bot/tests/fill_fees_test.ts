import { assertEquals } from "jsr:@std/assert";
import {
  computeNetTradePnl,
  extractLegFeeUsd,
  resolveFillVwap,
} from "../fill-fees.ts";

Deno.test("resolveFillVwap prefers order average", () => {
  assertEquals(resolveFillVwap({ average: 101.25 }, 100), 101.25);
  assertEquals(resolveFillVwap({}, 100), 100);
});

Deno.test("extractLegFeeUsd reads paper meta fee", () => {
  assertEquals(
    extractLegFeeUsd({
      amount: 1,
      average: 100,
      smart_execution_meta: { fee_usd: 0.1 },
    }),
    0.1,
  );
});

Deno.test("computeNetTradePnl subtracts both legs", () => {
  const pnl = computeNetTradePnl({
    qty: 2,
    entryPrice: 100,
    exitPrice: 101,
    feeUsdBuy: 0.2,
    feeUsdSell: 0.2,
  });
  assertEquals(pnl, 1.6);
});
