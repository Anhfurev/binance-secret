import { assertEquals } from "jsr:@std/assert";
import {
  cloneLlmAnalyzePayload,
  freshCrossProviderAbortSignal,
} from "../llm-provider-fallback.ts";

Deno.test("cloneLlmAnalyzePayload deep-clones JSON body", () => {
  const src = { symbol: "BTCUSDT", nested: { a: 1 } };
  const cloned = cloneLlmAnalyzePayload(src) as typeof src;
  cloned.nested.a = 99;
  assertEquals(src.nested.a, 1);
});

Deno.test("freshCrossProviderAbortSignal uses new timeout when cycle aborted", () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const sig = freshCrossProviderAbortSignal(ctrl.signal, 8000);
  assertEquals(sig.aborted, false);
});
