import { assertEquals } from "jsr:@std/assert";
import { readReconciliationEnabled } from "../reconciler.ts";

Deno.test("reconciliation stays off unless explicitly enabled", () => {
  Deno.env.delete("RECONCILER_ENABLED");
  assertEquals(readReconciliationEnabled(), false);
  Deno.env.set("RECONCILER_ENABLED", "1");
  assertEquals(readReconciliationEnabled(), true);
  Deno.env.delete("RECONCILER_ENABLED");
});
