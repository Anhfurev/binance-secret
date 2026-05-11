import { assertEquals } from "jsr:@std/assert";
import {
  DEFAULT_PRUNE_MIN_INTERVAL_MS,
  DEFAULT_STALE_MS,
  parsePruneMinIntervalMs,
  parseStaleMs,
  shouldRunStaleLockPrune,
} from "../trade-execution-lock-config.ts";

Deno.test("parseStaleMs defaults when unset", () => {
  assertEquals(parseStaleMs(""), DEFAULT_STALE_MS);
});

Deno.test("parseStaleMs clamps to bounds", () => {
  assertEquals(parseStaleMs("10000"), DEFAULT_STALE_MS);
  assertEquals(parseStaleMs("120000"), 120_000);
});

Deno.test("parsePruneMinIntervalMs defaults when unset", () => {
  assertEquals(parsePruneMinIntervalMs(""), DEFAULT_PRUNE_MIN_INTERVAL_MS);
});

Deno.test("shouldRunStaleLockPrune respects interval", () => {
  assertEquals(shouldRunStaleLockPrune(0, 60_000, 60_000), true);
  assertEquals(shouldRunStaleLockPrune(10_000, 50_000, 60_000), false);
});
