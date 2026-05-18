import { assertEquals } from "jsr:@std/assert";
import {
  applyBinanceTimeOffset,
  cachedTimeOffset,
  lastSyncTime,
  readHoistedLastSyncTime,
  readHoistedTimeOffset,
} from "../server-hoisted-state.ts";
import { isSupabaseEdgeRuntime } from "../edge-runtime.ts";

Deno.test("applyBinanceTimeOffset updates hoisted bindings", () => {
  applyBinanceTimeOffset(1_700_000_000_000, 1_699_999_999_000);
  assertEquals(readHoistedTimeOffset(), 1000);
  assertEquals(readHoistedLastSyncTime(), 1_699_999_999_000);
  assertEquals(cachedTimeOffset, 1000);
  assertEquals(lastSyncTime, 1_699_999_999_000);
});

Deno.test("isSupabaseEdgeRuntime is boolean without throwing", () => {
  assertEquals(typeof isSupabaseEdgeRuntime(), "boolean");
});
