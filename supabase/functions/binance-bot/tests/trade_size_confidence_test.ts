import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyConfidenceSizedTradeUsd,
  resolveConfidenceTradeUsdScale,
} from "../trade-size-confidence.ts";

Deno.test("resolveConfidenceTradeUsdScale grows with blended confidence", () => {
  const low = resolveConfidenceTradeUsdScale({
    aiConfidence: 78,
    weightedConfidence: 78,
    minAiConfidence: 78,
  });
  const high = resolveConfidenceTradeUsdScale({
    aiConfidence: 94,
    weightedConfidence: 94,
    minAiConfidence: 78,
  });
  assertEquals(low.tier, "floor");
  assertEquals(high.tier, "exceptional");
  assertEquals(high.scale > low.scale, true);
});

Deno.test("applyConfidenceSizedTradeUsd respects balance and min trade", () => {
  const sizing = resolveConfidenceTradeUsdScale({
    aiConfidence: 90,
    weightedConfidence: 90,
    minAiConfidence: 78,
  });
  const sized = applyConfidenceSizedTradeUsd({
    baseTradeUsd: 500,
    currentBalance: 1000,
    minTradeUsd: 10,
    sizing,
    useConfidenceScale: true,
  });
  assertEquals(sized > 500, true);
  assertEquals(sized <= 1000, true);
});
