import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveCronSymbolMatrixIndex,
  shouldPrefetchBtcMarketAnchor,
} from "../batch-validator.ts";

Deno.test("shouldPrefetchBtcMarketAnchor skips when cron hint or staging flag", () => {
  assertEquals(shouldPrefetchBtcMarketAnchor({ btcOverboughtHint: false }), false);
  assertEquals(shouldPrefetchBtcMarketAnchor({ btcOverboughtHint: true }), false);
  assertEquals(shouldPrefetchBtcMarketAnchor({ skipBtcMarketAnchor: true }), false);
  assertEquals(shouldPrefetchBtcMarketAnchor({}), true);
});

Deno.test("resolveCronSymbolMatrixIndex maps SOL to cron matrix slot 1", () => {
  assertEquals(resolveCronSymbolMatrixIndex("SOLUSDT"), 1);
  assertEquals(resolveCronSymbolMatrixIndex("BTCUSDT"), 0);
  assertEquals(resolveCronSymbolMatrixIndex("PEPEUSDT"), 2);
  assertEquals(resolveCronSymbolMatrixIndex("UNKNOWN"), undefined);
});
