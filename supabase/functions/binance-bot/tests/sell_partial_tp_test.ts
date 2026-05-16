import { assertEquals } from "jsr:@std/assert";
import {
  resolveOneToOneTakeProfitPrice,
  shouldTriggerPartialTakeProfit,
} from "../sell-partial-tp.ts";
import { checkExitConditions } from "../strategy.ts";

Deno.test("resolveOneToOneTakeProfitPrice mirrors initial stop distance", () => {
  assertEquals(resolveOneToOneTakeProfitPrice(100, 98), 102);
  assertEquals(resolveOneToOneTakeProfitPrice(100, 100), null);
});

Deno.test("shouldTriggerPartialTakeProfit fires at 1:1 reward", () => {
  const openTrade = {
    entryPrice: 100,
    stopLoss: 98,
    extra: {},
  } as any;
  assertEquals(shouldTriggerPartialTakeProfit(openTrade, 101.9), false);
  assertEquals(shouldTriggerPartialTakeProfit(openTrade, 102), true);
  assertEquals(
    shouldTriggerPartialTakeProfit({ ...openTrade, extra: { partial_tp_executed: true } }, 105),
    false,
  );
});

Deno.test("checkExitConditions labels armed break-even stop as be_stop_hit", () => {
  const exit = checkExitConditions({
    entryPrice: 100,
    stopLoss: 100.4,
    opened_at: new Date(Date.now() - 600_000).toISOString(),
    extra: {
      partial_tp_executed: true,
      break_even_after_partial_tp: true,
    },
  } as any, { latestPrice: 100.3 } as any);
  assertEquals(exit.shouldExit, true);
  assertEquals(exit.exit_reason, "be_stop_hit");
});
