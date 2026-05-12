import { assertEquals } from "jsr:@std/assert";
import { readGrinderMinWeightedEntry } from "../buy-helpers.ts";

Deno.test("grinder entry floor defaults to 62", () => {
  Deno.env.delete("GRINDER_MIN_WEIGHTED_CONFIDENCE");
  assertEquals(readGrinderMinWeightedEntry(), 62);
});

Deno.test("grinder entry floor honors env override", () => {
  Deno.env.set("GRINDER_MIN_WEIGHTED_CONFIDENCE", "72");
  assertEquals(readGrinderMinWeightedEntry(), 72);
  Deno.env.delete("GRINDER_MIN_WEIGHTED_CONFIDENCE");
});
