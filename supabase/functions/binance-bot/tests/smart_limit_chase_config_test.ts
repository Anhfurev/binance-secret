import { assertEquals } from "jsr:@std/assert@1";
import {
  computeAdverseSlippageFrac,
  readSmartLimitMaxChasePct,
  readSmartLimitMaxSlippagePct,
} from "../smart-limit-chase-config.ts";

Deno.test("readSmartLimitMaxChasePct defaults PEPE to 0.5", () => {
  Deno.env.delete("SMART_LIMIT_MAX_CHASE_PCT");
  Deno.env.delete("SMART_LIMIT_MAX_CHASE_PCT_PEPEUSDT");
  assertEquals(readSmartLimitMaxChasePct("PEPEUSDT"), 0.5);
});

Deno.test("readSmartLimitMaxSlippagePct is at least chase cap", () => {
  Deno.env.set("SMART_LIMIT_MAX_CHASE_PCT_PEPEUSDT", "0.3");
  Deno.env.set("SMART_LIMIT_MAX_SLIPPAGE_PCT_PEPEUSDT", "0.2");
  assertEquals(readSmartLimitMaxSlippagePct("PEPEUSDT"), 0.3);
  Deno.env.delete("SMART_LIMIT_MAX_CHASE_PCT_PEPEUSDT");
  Deno.env.delete("SMART_LIMIT_MAX_SLIPPAGE_PCT_PEPEUSDT");
});

Deno.test("computeAdverseSlippageFrac ignores favorable drift", () => {
  assertEquals(
    computeAdverseSlippageFrac({
      side: "buy",
      signalPrice: 100,
      referencePrice: 99,
    }),
    0,
  );
  assertEquals(
    computeAdverseSlippageFrac({
      side: "sell",
      signalPrice: 100,
      referencePrice: 101,
    }),
    0,
  );
  assertEquals(
    computeAdverseSlippageFrac({
      side: "buy",
      signalPrice: 100,
      referencePrice: 100.5,
    }),
    0.005,
  );
});
