import { assertEquals } from "jsr:@std/assert@1";
import {
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
