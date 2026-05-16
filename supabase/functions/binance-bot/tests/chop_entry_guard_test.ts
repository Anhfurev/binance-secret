import { assertEquals } from "jsr:@std/assert";
import { evaluateChopBuyBlock } from "../chop-entry-guard.ts";

Deno.test("evaluateChopBuyBlock rejects low ADX chop", () => {
  const out = evaluateChopBuyBlock({
    enabled: true,
    paperLiveStyle: true,
    snapshot: {
      adx14: 16,
      latestPrice: 100,
      ema50: 99,
      ema200: 98,
      marketRegime: "NEUTRAL",
      trend_htf: { mtf_effective_ok: true },
    } as any,
  });
  assertEquals(out.block, true);
});

Deno.test("evaluateChopBuyBlock allows trending momentum", () => {
  const out = evaluateChopBuyBlock({
    enabled: true,
    paperLiveStyle: true,
    snapshot: {
      adx14: 28,
      latestPrice: 101,
      ema50: 100,
      ema200: 99,
      marketRegime: "TRENDING",
      trend_htf: { mtf_effective_ok: true },
    } as any,
  });
  assertEquals(out.block, false);
});
