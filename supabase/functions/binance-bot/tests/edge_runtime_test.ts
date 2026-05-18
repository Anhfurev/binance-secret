import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mergeAbortSignals, readGatewayFetchTimeoutMs, readTelegramFetchTimeoutMs } from "../edge-runtime.ts";

Deno.test("mergeAbortSignals returns single or combined signal", () => {
  assertEquals(mergeAbortSignals([]), undefined);
  const one = AbortSignal.timeout(1000);
  assertEquals(mergeAbortSignals([one]), one);
  const merged = mergeAbortSignals([one, AbortSignal.timeout(2000)]);
  assertEquals(merged != null, true);
});

Deno.test("fetch timeout env readers stay bounded", () => {
  assertEquals(readGatewayFetchTimeoutMs() >= 2000, true);
  assertEquals(readTelegramFetchTimeoutMs() >= 2000, true);
});
