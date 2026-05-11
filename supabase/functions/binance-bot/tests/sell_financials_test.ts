import { assertEquals } from "jsr:@std/assert";
import { isPartialSellFill } from "../sell-financials.ts";

Deno.test("full fill when sold equals open amount", () => {
  assertEquals(isPartialSellFill(1, 1), false);
});

Deno.test("partial fill when sold below open amount", () => {
  assertEquals(isPartialSellFill(1, 0.5), true);
});

Deno.test("treats near-full fill as full", () => {
  assertEquals(isPartialSellFill(1, 0.9995), false);
});
