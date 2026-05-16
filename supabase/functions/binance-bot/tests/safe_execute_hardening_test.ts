// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import { describeThrownValue } from "../utils.ts";
import { safeRun } from "../safe-execute.ts";

Deno.test("describeThrownValue labels null undefined and empty Error", () => {
  assertEquals(describeThrownValue(null), "[thrown: null]");
  assertEquals(describeThrownValue(undefined), "[thrown: undefined]");
  assertEquals(describeThrownValue(""), "[thrown: empty_message]");
});

Deno.test("safeRun returns fallback when fn rejects with null", async () => {
  const r = await safeRun("reject_null", 99, () => Promise.reject(null));
  assertEquals(r, 99);
});

Deno.test("safeRun returns fallback when fn rejects with undefined", async () => {
  const r = await safeRun("reject_undef", "ok", () => Promise.reject(undefined));
  assertEquals(r, "ok");
});
