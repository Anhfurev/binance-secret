import { assertEquals } from "jsr:@std/assert@1";
import { mergeBalanceSyncTargets } from "../run-symbol-batch.ts";

Deno.test("mergeBalanceSyncTargets merges live flags and symbols", () => {
  const into = new Map<string, { isLiveMode: boolean; hasPaperMode: boolean; symbols: Set<string> }>();
  mergeBalanceSyncTargets(into, new Map([
    ["user-a", { isLiveMode: false, hasPaperMode: true, symbols: new Set(["BTCUSDT"]) }],
    ["user-b", { isLiveMode: true, hasPaperMode: false, symbols: new Set(["PEPEUSDT"]) }],
  ]));
  mergeBalanceSyncTargets(into, new Map([
    ["user-a", { isLiveMode: true, hasPaperMode: false, symbols: new Set(["SOLUSDT"]) }],
  ]));
  assertEquals(into.get("user-a")?.isLiveMode, true);
  assertEquals(into.get("user-a")?.hasPaperMode, true);
  assertEquals([...(into.get("user-a")?.symbols ?? [])].sort(), ["BTCUSDT", "SOLUSDT"]);
  assertEquals(into.get("user-b")?.isLiveMode, true);
});
