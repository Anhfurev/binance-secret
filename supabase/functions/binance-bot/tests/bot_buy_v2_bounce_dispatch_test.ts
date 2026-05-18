import { assertEquals } from "jsr:@std/assert";
import {
  evaluateBounceDispatchBalanceGate,
  isLegacyDbLiveBalanceSkip,
} from "../buy-live-wallet-sizing.ts";
import { qualifiesOversoldBounceRelaxedPath } from "../buy-bounce-floor.ts";

Deno.test("qualifiesOversoldBounceRelaxedPath matches oversold_bounce_confirmed_buy stamp", () => {
  assertEquals(
    qualifiesOversoldBounceRelaxedPath({
      matrixBuyReason: "oversold_bounce_confirmed_buy|bounce_override_ai_soft_sell",
      combinedTrace: "strategy_oversold_bounce_entry|oversold_bounce_confirmed_buy",
    }),
    true,
  );
});

Deno.test("legacy DB balance skip bypassed for bounce at executeBuyFlow layer", () => {
  const skip = "BUY blocked: Insufficient actual live balance. Required: $12.00, Available: $0.00";
  assertEquals(isLegacyDbLiveBalanceSkip(skip), true);
  const gate = evaluateBounceDispatchBalanceGate(15, 12);
  assertEquals(gate.success, true);
});
