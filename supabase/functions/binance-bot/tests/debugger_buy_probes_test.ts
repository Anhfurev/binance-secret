import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bucketHoldReason,
  extractWarRoomHoldReason,
  summarizeWarRoomBuyAudits,
} from "../debugger-buy-probes.ts";

Deno.test("extractWarRoomHoldReason reads veto_details.reason", () => {
  assertEquals(
    extractWarRoomHoldReason({ reason: "hold_no_strategy_buy|tail" }),
    "hold_no_strategy_buy|tail",
  );
  assertEquals(extractWarRoomHoldReason("{}"), "unknown_hold");
});

Deno.test("bucketHoldReason strips pipe tail", () => {
  assertEquals(bucketHoldReason("hold_low_adx_chop|adx=12"), "hold_low_adx_chop");
});

Deno.test("summarizeWarRoomBuyAudits counts BUY/HOLD and no-strategy", () => {
  const rows = [
    { final_decision: "BUY", veto_details: {} },
    { final_decision: "HOLD", veto_details: { reason: "hold_no_strategy_buy|x" } },
    { final_decision: "HOLD", veto_details: { reason: "hold_ai_confidence_too_low" } },
    { final_decision: "SELL", veto_details: {} },
  ];
  const s = summarizeWarRoomBuyAudits(rows);
  assertEquals(s.buy, 1);
  assertEquals(s.hold, 2);
  assertEquals(s.sell, 1);
  assertEquals(s.hold_no_strategy, 1);
  assertEquals(s.top_hold_buckets[0]?.bucket, "hold_no_strategy_buy");
});
