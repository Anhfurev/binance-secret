import { assertEquals } from "jsr:@std/assert";
import {
  readDemoProbeEnabled,
  resolvePaperWalletUsdt,
  shouldApplyPaperDemoLedgerDelta,
} from "../paper-balance.ts";

Deno.test("paper ledger skips ghost shadow fills", () => {
  assertEquals(shouldApplyPaperDemoLedgerDelta(true, false), true);
  assertEquals(shouldApplyPaperDemoLedgerDelta(true, true), false);
  assertEquals(shouldApplyPaperDemoLedgerDelta(false, false), false);
});

Deno.test("resolvePaperWalletUsdt prefers profile demo balance", () => {
  Deno.env.delete("TEST_USDT_BALANCE");
  assertEquals(resolvePaperWalletUsdt(8885.09), 8885.09);
});

Deno.test("demo probe disabled by default", () => {
  Deno.env.delete("DEMO_PROBE_ENABLED");
  assertEquals(readDemoProbeEnabled(), false);
  Deno.env.set("DEMO_PROBE_ENABLED", "1");
  assertEquals(readDemoProbeEnabled(), true);
  Deno.env.delete("DEMO_PROBE_ENABLED");
});
