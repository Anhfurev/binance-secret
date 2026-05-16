import { assertEquals } from "jsr:@std/assert";
import { resolveOpenLegRemainingValue } from "../sell-partial.ts";

Deno.test("resolveOpenLegRemainingValue marks remaining base at exit price", () => {
  assertEquals(resolveOpenLegRemainingValue(0.5, 102), 51);
  assertEquals(resolveOpenLegRemainingValue(0, 100), 0);
});
