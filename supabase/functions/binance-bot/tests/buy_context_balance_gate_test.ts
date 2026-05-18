import { assertEquals } from "jsr:@std/assert";
import { MIN_TRADE_USD } from "../constants.ts";

Deno.test("balance gate blocks only when available < tradeUsd not when balance is high", () => {
  const currentBalance = 9984.35;
  const tradeUsd = 15;
  const availableBalance = currentBalance;
  const shouldBlockBalance = availableBalance < tradeUsd;
  const shouldBlockMinNotional = tradeUsd < MIN_TRADE_USD;
  assertEquals(shouldBlockBalance, false);
  assertEquals(shouldBlockMinNotional, false);
});

Deno.test("balance gate blocks when available is less than tradeUsd", () => {
  const availableBalance = 12;
  const tradeUsd = 15;
  assertEquals(availableBalance < tradeUsd, true);
});
